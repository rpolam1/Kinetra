GOOD_THRESHOLD = 80.0
NEEDS_THRESHOLD = 50.0


def classify(score):
    if score is None:
        return None
    if score >= GOOD_THRESHOLD:
        return "good_form"
    if score >= NEEDS_THRESHOLD:
        return "needs_correction"
    return "flag_for_instructor"


def _iou(s1, e1, s2, e2):
    overlap = max(0.0, min(e1, e2) - max(s1, s2))
    union = max(e1, e2) - min(s1, s2)
    return overlap / union if union > 0 else 0.0


class RepFusion:
    def __init__(self, overlap_iou=0.35, ambiguity_margin=0.1):
        self.overlap_iou = overlap_iou
        self.ambiguity_margin = ambiguity_margin
        self.reps = {}  # canonical id -> canonical rep dict
        self.track_patient = {}  # track_key -> patient_id (bind events or inferred)
        self.inferred = set()  # track_keys whose identity was inferred, not tag-bound
        self._votes = {}  # track_key -> {patient_id: n agreeing merges}
        self._voted = set()  # (track_key, canonical id) already counted
        self._next_id = 1

    def add_rep(self, obs):
        obs = dict(obs)
        if obs.get("patient_id") is None and obs.get("track_key") in self.track_patient:
            obs["patient_id"] = self.track_patient[obs["track_key"]]

        cands = []
        for c in self.reps.values():
            if obs["camera_id"] in c["cameras"]:
                continue
            if c["exercise"] != obs.get("exercise"):
                continue
            if c["patient_id"] and obs.get("patient_id") and c["patient_id"] != obs["patient_id"]:
                continue
            iou = _iou(c["t_start"], c["t_end"], obs["t_start"], obs["t_end"])
            if iou < self.overlap_iou:
                continue
            both_known = bool(c["patient_id"] and obs.get("patient_id"))
            cands.append((iou + (1.0 if both_known else 0.0), iou, c))

        target = None
        if cands:
            cands.sort(key=lambda x: -x[0])
            target = cands[0][2]
            if obs.get("patient_id") is None:
                # anonymous: don't guess between known people
                near = [c for s, i, c in cands if cands[0][1] - i <= self.ambiguity_margin]
                people = {c["patient_id"] for c in near if c["patient_id"]}
                if len(people) > 1:
                    target = None

        if target is None:
            return self._new(obs)
        self._merge(target, obs)
        if target["patient_id"]:
            self._consolidate(target["patient_id"], target["exercise"])
        return target["id"]

    def bind(self, track_key, patient_id):
        self.track_patient[track_key] = patient_id
        touched = set()
        for c in self.reps.values():
            if c["patient_id"] is None and any(o.get("track_key") == track_key for o in c["observations"]):
                c["patient_id"] = patient_id
                for o in c["observations"]:
                    if o.get("track_key") == track_key:
                        o["patient_id"] = patient_id
                touched.add(c["exercise"])
        for ex in touched:
            self._consolidate(patient_id, ex)

    def _new(self, obs):
        cid = self._next_id
        self._next_id += 1
        c = {"id": cid, "patient_id": obs.get("patient_id"), "exercise": obs.get("exercise"),
             "observations": [], "cameras": set(), "t_start": obs["t_start"], "t_end": obs["t_end"],
             "score": None, "label": None, "issues": [], "coverage": 0.0, "partial_return": False,
             "rom": None}
        self.reps[cid] = c
        self._merge(c, obs)
        return cid

    def _merge(self, c, obs):
        c["observations"].append(obs)
        c["cameras"].add(obs["camera_id"])
        if obs.get("patient_id") and not c["patient_id"]:
            c["patient_id"] = obs["patient_id"]
        self._recompute(c)
        self._collect_votes(c)

    def _collect_votes(self, c):
        pid = c["patient_id"]
        if not pid or len(c["cameras"]) < 2:
            return
        for o in c["observations"]:
            tk = o.get("track_key")
            if o.get("patient_id") is None and tk and (tk, c["id"]) not in self._voted:
                self._voted.add((tk, c["id"]))
                v = self._votes.setdefault(tk, {})
                v[pid] = v.get(pid, 0) + 1
                self._maybe_infer(tk)

    def _maybe_infer(self, track_key):
        if track_key in self.track_patient:
            return
        v = self._votes.get(track_key, {})
        total = sum(v.values())
        best, n = max(v.items(), key=lambda kv: kv[1])
        if n >= 2 and n / total >= 0.85:
            self.inferred.add(track_key)
            self.bind(track_key, best)

    def _recompute(self, c):
        obs = c["observations"]
        w = [max(float(o.get("coverage") or 0.0), 0.05) for o in obs]
        tw = sum(w)
        c["t_start"] = sum(wi * o["t_start"] for wi, o in zip(w, obs)) / tw
        c["t_end"] = sum(wi * o["t_end"] for wi, o in zip(w, obs)) / tw
        scored = [(wi, o["score"]) for wi, o in zip(w, obs) if o.get("score") is not None]
        if scored:
            c["score"] = round(sum(wi * s for wi, s in scored) / sum(wi for wi, _ in scored), 1)
        else:
            c["score"] = None
        c["label"] = classify(c["score"]) or (obs[0].get("label") if obs else None)
        c["coverage"] = round(max(float(o.get("coverage") or 0.0) for o in obs), 2)
        c["partial_return"] = any(o.get("partial_return") for o in obs)
        roms = [(wi, float(o["rom"])) for wi, o in zip(w, obs) if isinstance(o.get("rom"), (int, float))]
        c["rom"] = round(sum(wi * r for wi, r in roms) / sum(wi for wi, _ in roms), 1) if roms else None
        issues = []
        for o in sorted(obs, key=lambda o: -(o.get("coverage") or 0.0)):
            for i in o.get("issues") or []:
                if i not in issues:
                    issues.append(i)
        c["issues"] = issues[:6]

    def _consolidate(self, patient_id, exercise):
        merged = True
        while merged:
            merged = False
            mine = [c for c in self.reps.values()
                    if c["patient_id"] == patient_id and c["exercise"] == exercise]
            for i, a in enumerate(mine):
                for b in mine[i + 1:]:
                    if a["cameras"] & b["cameras"]:
                        continue
                    if _iou(a["t_start"], a["t_end"], b["t_start"], b["t_end"]) >= self.overlap_iou:
                        for o in b["observations"]:
                            a["observations"].append(o)
                            a["cameras"].add(o["camera_id"])
                        self._recompute(a)
                        del self.reps[b["id"]]
                        merged = True
                        break
                if merged:
                    break

    def canonical_reps(self, patient_id="__any__", exercise=None):
        out = [c for c in self.reps.values()
               if (patient_id == "__any__" or c["patient_id"] == patient_id)
               and (exercise is None or c["exercise"] == exercise)]
        return sorted(out, key=lambda c: c["t_start"])


def compute_sets(reps, gap_seconds=20.0):
    sets, cur = [], []
    for r in sorted(reps, key=lambda r: r["t_start"]):
        if cur and r["t_start"] - cur[-1]["t_end"] > gap_seconds:
            sets.append(cur)
            cur = []
        cur.append(r)
    if cur:
        sets.append(cur)
    out = []
    for i, s in enumerate(sets, 1):
        scores = [r["score"] for r in s if r["score"] is not None]
        out.append({
            "set_index": i, "reps": len(s),
            "t_start": s[0]["t_start"], "t_end": s[-1]["t_end"],
            "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
            "good": sum(r["label"] == "good_form" for r in s),
            "needs_correction": sum(r["label"] == "needs_correction" for r in s),
            "flagged": sum(r["label"] == "flag_for_instructor" for r in s),
            "rep_ids": [r["id"] for r in s],
        })
    return out
