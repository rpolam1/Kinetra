from flask import jsonify, request

from server.heart import HeartError, parse_samples

MAX_PATIENT_ID = 64
MAX_DEVICE_ID = 80


def register_vitals_routes(app, core):
    live = core.live

    def _fail(message, status=400):
        return jsonify({"error": message}), status

    @app.post("/api/vitals")
    def post_vitals():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return _fail("expected a JSON object")
        patient_id = body.get("patient_id")
        if not isinstance(patient_id, str) or not patient_id.strip() or len(patient_id) > MAX_PATIENT_ID:
            return _fail("patient_id is required")
        device_id = str(body.get("device_id") or "")[:MAX_DEVICE_ID]
        patient_id = patient_id.strip()
        try:
            samples = parse_samples(body.get("samples"), live.clock())
        except HeartError as e:
            return _fail(str(e))
        with core.lock:
            core.heart.add(patient_id, samples)
            core.patients_seen.add(patient_id)
            core.devices[patient_id] = {"device_id": device_id, "last_seen": live.clock()}
            status = live.heart_status(patient_id)
        live.publish_live()
        return jsonify({"ok": True, "accepted": len(samples), "status": status})

    @app.get("/api/vitals/<patient_id>")
    def get_vitals(patient_id):
        with core.lock:
            return jsonify({"patient_id": patient_id, "status": live.heart_status(patient_id)})

    @app.get("/api/watch/roster")
    def watch_roster():
        now = live.clock()
        with core.lock:
            sess = live.session.state()
            in_session = set(sess["order"]) if sess and sess["ended_at"] is None else set()
            seen = live.presence.patients(now)
            people = []
            for tag_id, entry in sorted(core.store.tags().items()):
                pid = entry["patient_id"]
                people.append({"tag_id": tag_id, "patient_id": pid,
                               "display_name": entry.get("display_name") or pid,
                               "in_session": pid in in_session, "in_view": pid in seen,
                               "watch_connected": pid in core.devices
                               and now - core.devices[pid]["last_seen"] <= 30.0})
            people.sort(key=lambda p: (not p["in_session"], not p["in_view"], p["tag_id"]))
            return jsonify({"server_time": now, "session_active": bool(in_session),
                            "tags_managed": bool(people), "people": people})
