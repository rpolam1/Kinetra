"""Tests for the tag registry on the hub and for how the camera uses it."""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import cv2, numpy as np
from server.hub import HubCore, create_app
from formcheck.identity import TagDetector
from client import CameraPipeline


def client(**kw):
    """A test client and the hub core behind it."""
    app = create_app(HubCore(), **kw)
    return app.test_client(), app.config["core"]


def test_tag_registry_crud_and_state():
    c, _ = client()
    assert c.get("/api/state").json["tags_managed"] is False
    assert c.put("/api/tags/12", json={"patient_id": "P-0001", "display_name": "Ana"}).json == {"ok": True}
    st = c.get("/api/state").json
    assert st["tags_managed"] is True and st["tags"]["12"] == {"patient_id": "P-0001", "display_name": "Ana"}
    assert c.get("/api/tags").json["tags"]["12"]["patient_id"] == "P-0001"
    assert c.delete("/api/tags/12").json == {"ok": True, "deleted": True}
    assert c.delete("/api/tags/12").json["deleted"] is False
    assert c.get("/api/state").json["tags_managed"] is False


def test_tag_validation():
    c, _ = client()
    for bad in ({}, {"patient_id": ""}, {"patient_id": 5}, {"patient_id": "x" * 65},
                {"patient_id": "ok", "display_name": "n" * 41}):
        assert c.put("/api/tags/3", json=bad).status_code == 400, bad
    assert c.put("/api/tags/587", json={"patient_id": "p"}).status_code == 400  # 36h11 has ids 0..586
    assert c.put("/api/tags/586", json={"patient_id": "p"}).status_code == 200


def test_bulk_replace_is_atomic_and_validated():
    c, core = client()
    c.put("/api/tags/1", json={"patient_id": "old"})
    r = c.put("/api/tags", json={"tags": {"5": {"patient_id": "A", "display_name": "Al"}, "9": {"patient_id": "B"}}})
    assert r.json == {"ok": True, "count": 2}
    assert set(core.store.tags()) == {5, 9}
    assert c.put("/api/tags", json={"tags": {"abc": {"patient_id": "A"}}}).status_code == 400
    assert c.put("/api/tags", json={"tags": {"700": {"patient_id": "A"}}}).status_code == 400
    assert set(core.store.tags()) == {5, 9}  # a rejected request changes nothing


def test_tag_png_is_a_real_readable_apriltag():
    c, _ = client()
    r = c.get("/api/tags/42.png?size=300")
    assert r.status_code == 200 and r.mimetype == "image/png"
    img = cv2.imdecode(np.frombuffer(r.data, np.uint8), cv2.IMREAD_COLOR)
    canvas = np.full((480, 640, 3), 255, np.uint8)
    canvas[40:40 + img.shape[0], 40:40 + img.shape[1]] = img
    assert [t["tag_id"] for t in TagDetector().detect(canvas)] == [42]
    assert c.get("/api/tags/9999.png").status_code == 404


def test_registry_changes_are_persisted_across_restart():
    path = os.path.join(tempfile.mkdtemp(), "hub.db")
    c, core = client()
    core2 = HubCore(path); core2.store.set_tag(7, "P-0007", "Bo"); core2.store.close()
    assert HubCore(path).store.tags()[7]["patient_id"] == "P-0007"


class FakeLink:
    """A hub link that only holds a state dict."""
    def __init__(self, state): self.state = state; self.camera_id = "cam"
    def assigned_exercise(self, *a): return None


def mapped(state, tag_id, tag_map=None):
    """Patient ids that the camera pipeline gives to a tag."""
    p = CameraPipeline({}, None, FakeLink(state), tag_map=tag_map)
    out = p._map_tags([{"tag_id": tag_id, "center": (0, 0), "size": 10}])
    return [t["patient_id"] for t in out]


def test_camera_uses_registry_and_ignores_unknown_tags_once_managed():
    state = {"tags": {"12": {"patient_id": "P-0001"}}, "tags_managed": True}
    assert mapped(state, 12) == ["P-0001"]
    assert mapped(state, 99) == []  # stray tag: ignored, no phantom patient


def test_camera_falls_back_to_legacy_mapping_without_registry():
    assert mapped({}, 5) == ["p005"]
    assert mapped({"tags": {}, "tags_managed": False}, 5, {5: "alice"}) == ["alice"]


def test_hub_serves_the_web_app_and_keeps_api_protected():
    web = tempfile.mkdtemp()
    os.makedirs(os.path.join(web, "assets"))
    open(os.path.join(web, "index.html"), "w").write("<html>APP</html>")
    open(os.path.join(web, "assets", "app.js"), "w").write("console.log(1)")
    c, _ = client(web_dir=web, api_key="k")
    assert b"APP" in c.get("/").data
    assert c.get("/assets/app.js").data == b"console.log(1)"
    assert b"APP" in c.get("/patients/123").data  # SPA deep link falls back to index
    assert c.get("/api/nope", headers={"X-API-Key": "k"}).status_code == 404
    assert c.get("/api/state").status_code == 401  # api still needs the key
    assert c.get("/api/tags/5.png").status_code == 200  # tag images stay open for <img>
    assert c.get("/api/tags").status_code == 401
    assert c.get("/api/state", headers={"X-API-Key": "k"}).status_code == 200
    assert c.get("/../hub.db").status_code in (200, 404) and b"SQLite" not in c.get("/../hub.db").data


def test_a_relative_web_folder_works_from_any_working_directory():
    import tempfile
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "web", "dist"))
    open(os.path.join(root, "web", "dist", "index.html"), "w").write("<html>relative ok</html>")
    previous = os.getcwd()
    os.chdir(root)
    try:
        client = create_app(HubCore(), web_dir=os.path.join("web", "dist")).test_client()
        assert b"relative ok" in client.get("/").data
        assert b"relative ok" in client.get("/board").data  # single-page-app fallback
    finally:
        os.chdir(previous)


if __name__ == "__main__":
    failed = 0
    for n, fn in list(globals().items()):
        if n.startswith("test_"):
            try: fn(); print("PASS ", n)
            except AssertionError as e: failed += 1; print("FAIL ", n, e)
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED"); sys.exit(1 if failed else 0)
