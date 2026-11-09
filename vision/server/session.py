import time
import uuid

from server.fusion import compute_sets
from server.heart import HeartError, normalize_zone

TRACKING = ("scored", "count_only", "timed", "manual")
MAX_PARTICIPANTS = 60
MAX_PLAN = 40
KV_KEY = "session"


class SessionError(Exception):

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _int(value, lo, hi):
    return isinstance(value, int) and not isinstance(value, bool) and lo <= value <= hi


def _text(value, limit):
    return isinstance(value, str) and len(value) <= limit


def normalize_participants(raw):
    if not isinstance(raw, list) or not raw:
        raise SessionError("invalid", "participants must be a non-empty list")
    if len(raw) > MAX_PARTICIPANTS:
        raise SessionError("invalid", f"at most {MAX_PARTICIPANTS} participants")
    seen, out = set(), []
    for p in raw:
        if not isinstance(p, dict):
            raise SessionError("invalid", "each participant must be an object")
        pid = p.get("patient_id")
        if not isinstance(pid, str) or not pid.strip() or len(pid) > 64:
            raise SessionError("invalid", "patient_id is required")
        if pid in seen:
            raise SessionError("invalid", f"{pid} is listed twice")
        seen.add(pid)
        name = p.get("board_name")
        if not isinstance(name, str) or not name.strip() or len(name) > 40:
            raise SessionError("invalid", f"{pid}: board_name is required")
        plan = p.get("plan")
        if not isinstance(plan, list) or not 1 <= len(plan) <= MAX_PLAN:
            raise SessionError("invalid", f"{pid}: plan must have 1-{MAX_PLAN} exercises")
        items = []
        for item in plan:
            if not isinstance(item, dict) or not isinstance(item.get("exercise_id"), str) or not item["exercise_id"]:
                raise SessionError("invalid", f"{pid}: each plan item needs an exercise_id")
            tracking = item.get("tracking", "manual")
            sets, reps, seconds = item.get("sets", 1), item.get("reps"), item.get("seconds")
            if tracking not in TRACKING or not _int(sets, 1, 10) \
                    or (reps is not None and not _int(reps, 1, 500)) \
                    or (seconds is not None and not _int(seconds, 1, 3600)) \
                    or not _text(item.get("name", ""), 80) or not _text(item.get("load", ""), 60) \
                    or not _text(item.get("modification", ""), 80):
                raise SessionError("invalid", f"{pid}: bad plan item '{item.get('exercise_id')}'")
            items.append({"exercise_id": item["exercise_id"], "name": item.get("name") or item["exercise_id"],
                          "tracking": tracking, "sets": sets, "reps": reps, "seconds": seconds,
                          "load": item.get("load", ""), "modification": item.get("modification", "")})
        try:
            zone = normalize_zone(p.get("heart_zone"))
        except HeartError as e:
            raise SessionError("invalid", f"{pid}: {e}")
        out.append({"patient_id": pid.strip(), "board_name": name.strip(), "plan": items, "heart_zone": zone})
    return out


def exercise_progress(item, reps, set_gap, now):
    per_set = item.get("reps")
    target_sets = item.get("sets") or 1
    sets = compute_sets(reps, set_gap)
    sets_done = sum(1 for s in sets if per_set is None or s["reps"] >= per_set)
    current = sets[-1] if sets and now - sets[-1]["t_end"] <= set_gap else None
    in_progress = current is not None and (per_set is None or current["reps"] < per_set)
    target_total = target_sets * per_set if per_set else None
    return {
        "reps_done": len(reps),
        "target_reps": per_set,
        "target_sets": target_sets,
        "sets_done": min(sets_done, target_sets),
        "set_number": min(sets_done + 1, target_sets),  # the set they are on, or about to start
        "current_set_reps": current["reps"] if in_progress else 0,
        "target_met": target_total is not None and len(reps) >= target_total,
    }


class SessionManager:
    def __init__(self, store=None, clock=time.time):
        self.store = store
        self.clock = clock
        self._state = store.kv_get(KV_KEY) if store else None

    @property
    def active(self):
        return bool(self._state) and self._state.get("ended_at") is None

    def state(self):
        return self._state

    def participant(self, patient_id):
        return (self._state or {}).get("participants", {}).get(patient_id)

    def order(self):
        return list((self._state or {}).get("order", []))

    def current_item(self, patient_id):
        p = self.participant(patient_id)
        if not p or p["finished"]:
            return None
        return p["plan"][p["index"]]

    def _save(self):
        if self.store:
            self.store.kv_set(KV_KEY, self._state)

    def start(self, raw_participants, auto_advance=False):
        if self.active:
            raise SessionError("conflict", "A session is already running. End it first.")
        participants = normalize_participants(raw_participants)
        now = self.clock()
        self._state = {
            "id": uuid.uuid4().hex[:10], "started_at": now, "ended_at": None,
            "auto_advance": bool(auto_advance), "order": [p["patient_id"] for p in participants],
            "participants": {p["patient_id"]: {**p, "index": 0, "exercise_started_at": now,
                                               "done": [], "finished": False} for p in participants},
        }
        self._save()
        return self._state

    def end(self):
        if not self.active:
            raise SessionError("conflict", "No session is running")
        self._state["ended_at"] = self.clock()
        self._save()
        return self._state

    def set_auto_advance(self, enabled):
        if not self.active:
            raise SessionError("conflict", "No session is running")
        self._state["auto_advance"] = bool(enabled)
        self._save()

    def advance(self, patient_id, to_index=None):
        if not self.active:
            raise SessionError("conflict", "No session is running")
        p = self.participant(patient_id)
        if p is None:
            raise SessionError("not_found", f"{patient_id} is not in this session")
        now = self.clock()
        if to_index is None:
            if p["finished"]:
                raise SessionError("conflict", f"{p['board_name']} has already finished")
            if not any(d["index"] == p["index"] for d in p["done"]):
                p["done"].append({"index": p["index"], "exercise_id": p["plan"][p["index"]]["exercise_id"],
                                  "completed_at": now})
            if p["index"] + 1 >= len(p["plan"]):
                p["finished"] = True
            else:
                p["index"] += 1
        else:
            if not _int(to_index, 0, len(p["plan"]) - 1):
                raise SessionError("invalid", "to_index is out of range")
            p["index"], p["finished"] = to_index, False
        p["exercise_started_at"] = now
        self._save()
        return p
