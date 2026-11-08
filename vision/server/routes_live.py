import functools

from flask import Response, jsonify, request, stream_with_context

from server.calibration import CalibrationError
from server.session import SessionError

STATUS = {"invalid": 400, "not_found": 404, "conflict": 409, "too_few": 422, "unusable": 422}
STREAM_TOPICS = {"status", "calibration", "skeleton"}


def _body():
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def _fail(message, code="invalid"):
    return jsonify({"error": message, "code": code}), STATUS.get(code, 400)


def _handled(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except (CalibrationError, SessionError) as e:
            return _fail(e.message, e.code)
        except ValueError as e:
            return _fail(str(e))
    return wrapper


def register_live_routes(app, core):
    live = core.live

    @app.get("/api/live")
    def live_snapshot():
        return jsonify(live.live_snapshot())

    @app.get("/api/stream")
    def stream():
        topics = {t for t in request.args.get("topics", "status").split(",") if t in STREAM_TOPICS}
        if not topics:
            return _fail("topics must include status, calibration or skeleton")
        job = request.args.get("job") or None
        initial = []
        if "status" in topics:
            initial.append(("status", live.live_snapshot()))
        if job and "calibration" in topics:
            try:
                initial.append(("calibration", live.calibration.summary(live.calibration.get(job))))
            except CalibrationError as e:
                return _fail(e.message, e.code)
        generator = live.bus.stream(topics, key=job, initial=initial, stop=live.stop_event)
        return Response(stream_with_context(generator), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})

    @app.post("/api/presence")
    @_handled
    def presence():
        body = _body()
        camera_id = body.get("camera_id")
        if not isinstance(camera_id, str) or not camera_id.strip():
            return _fail("camera_id is required")
        live.presence_update(camera_id, body.get("people", []))
        return jsonify({"ok": True})

    @app.get("/api/session")
    def session_get():
        return jsonify({"session": live.session.state()})

    @app.put("/api/session")
    @_handled
    def session_start():
        body = _body()
        state = live.session_start(body.get("participants"), bool(body.get("auto_advance", False)))
        return jsonify({"ok": True, "session": state})

    @app.post("/api/session/end")
    @_handled
    def session_end():
        return jsonify({"ok": True, "summary": live.session_end()})

    @app.post("/api/session/advance")
    @_handled
    def session_advance():
        body = _body()
        patient_id = body.get("patient_id")
        if not isinstance(patient_id, str):
            return _fail("patient_id is required")
        live.session_advance(patient_id, body.get("to_index"))
        return jsonify({"ok": True})

    @app.post("/api/session/auto-advance")
    @_handled
    def session_auto_advance():
        live.session_set_auto_advance(bool(_body().get("enabled")))
        return jsonify({"ok": True})

    @app.get("/api/calibration")
    def calibration_list():
        return jsonify({"jobs": live.calibration.active_jobs()})

    @app.post("/api/calibration")
    @_handled
    def calibration_create():
        body = _body()
        job = live.calibration_create(body.get("patient_id"), body.get("exercise"),
                                      body.get("camera_id"), body.get("target_reps", 5))
        return jsonify(job), 201

    @app.get("/api/calibration/<job_id>")
    @_handled
    def calibration_get(job_id):
        job = live.calibration.get(job_id)
        return jsonify({**live.calibration.summary(job), "frame": job["last_frame"]})

    @app.get("/api/calibration/<job_id>/reps/<int:index>")
    @_handled
    def calibration_rep(job_id, index):
        return jsonify(live.calibration.rep_detail(job_id, index))

    @app.post("/api/calibration/<job_id>/claim")
    @_handled
    def calibration_claim(job_id):
        camera_id = _body().get("camera_id")
        if not isinstance(camera_id, str) or not camera_id.strip():
            return _fail("camera_id is required")
        return jsonify(live.calibration_claim(job_id, camera_id))

    @app.post("/api/calibration/<job_id>/frame")
    @_handled
    def calibration_frame(job_id):
        body = _body()
        live.calibration_frame(job_id, body.get("camera_id"), body.get("frame"))
        return jsonify({"ok": True})

    @app.post("/api/calibration/<job_id>/reps/<int:index>/decision")
    @_handled
    def calibration_decision(job_id, index):
        return jsonify(live.calibration_decide(job_id, index, _body().get("decision")))

    @app.post("/api/calibration/<job_id>/finish")
    @_handled
    def calibration_finish(job_id):
        return jsonify(live.calibration_finish(job_id))

    @app.post("/api/calibration/<job_id>/cancel")
    @_handled
    def calibration_cancel(job_id):
        return jsonify(live.calibration_cancel(job_id))