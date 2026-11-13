"""Tests for how clients find the hub: broadcast, subnet scan, cached address, and one laptop hosting the hub for the others."""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from test_hub_client import RunningHub, judgment
from server.hub import EmbeddedHub, create_app, host_if_alone, HubCore
from formcheck import discovery as d
from formcheck.hub_client import HubLink

# Each test gets its own port so a hub left over from an earlier test cannot answer
_port = [56000]


def next_port():
    """The next unused test port."""
    _port[0] += 1
    return _port[0]


def tmp_cache():
    """A cache file path in a fresh temporary folder."""
    return os.path.join(tempfile.mkdtemp(), ".hub_url")


def start_responder(hub, dport):
    """Start a discovery responder for a hub and fail if it cannot bind."""
    r = d.DiscoveryResponder(http_port=hub.port, port=dport)
    r.start()
    time.sleep(0.3)
    assert r.error is None, r.error
    return r


def test_udp_broadcast_finds_hub_without_any_address():
    hub, dport = RunningHub(), next_port()
    r = start_responder(hub, dport)
    try:
        found = d.probe_udp(1.5, port=dport, broadcast=["127.0.0.1"])
        assert [i["url"] for i in found] == [hub.url], found
    finally:
        r.stop(); hub.stop()


def test_wrong_placeholder_address_falls_back_to_discovery():
    hub, dport = RunningHub(), next_port()
    r = start_responder(hub, dport)
    try:
        msgs = []
        url = d.find_hub(preferred="http://HUB:5000", cache_path=tmp_cache(), port=dport,
                         http_port=1, broadcast=["127.0.0.1"], scan=False, log=msgs.append)
        assert url == hub.url, (url, msgs)
        assert any("not reachable" in m for m in msgs)
    finally:
        r.stop(); hub.stop()


def test_bare_ip_without_scheme_or_port_is_accepted():
    assert d.normalize_url("192.168.1.5") == "http://192.168.1.5:5000"
    assert d.normalize_url("lab-pc:6000") == "http://lab-pc:6000"
    assert d.normalize_url(" http://x:5000/ ") == "http://x:5000"
    hub = RunningHub()
    try:
        url = d.find_hub(preferred=f"127.0.0.1:{hub.port}", cache_path=tmp_cache(), scan=False,
                         broadcast=[], http_port=1)
        assert url == hub.url
    finally:
        hub.stop()


def test_subnet_scan_works_when_broadcast_is_blocked():
    hub = RunningHub()
    try:
        found = d.scan_subnet(port=hub.port, hosts=["127.0.0.1", "127.0.0.3", "127.0.0.4"])
        assert [i["url"] for i in found] == [hub.url]
        # and a fully dead network returns nothing, quickly
        t0 = time.time()
        assert d.scan_subnet(port=1, hosts=["127.0.0.1"], timeout=0.3) == []
        assert time.time() - t0 < 3
    finally:
        hub.stop()


def test_find_hub_falls_through_to_scan_when_udp_gets_no_answer():
    hub = RunningHub()
    try:
        url = d.find_hub(cache_path=tmp_cache(), port=next_port(), http_port=hub.port,
                         broadcast=["127.0.0.1"], scan_hosts=["127.0.0.1"], udp_timeout=0.4)
        assert url == hub.url  # (found on localhost / scan; no responder running)
    finally:
        hub.stop()


def test_cache_used_and_stale_cache_ignored():
    hub, dport = RunningHub(), next_port()
    r = start_responder(hub, dport)
    try:
        cache = tmp_cache()
        open(cache, "w").write("http://10.255.255.1:5000")  # stale, unreachable
        url = d.find_hub(cache_path=cache, port=dport, http_port=1, broadcast=["127.0.0.1"], scan=False)
        assert url == hub.url and open(cache).read() == hub.url  # refreshed
        r.stop(); time.sleep(0.7)
        url2 = d.find_hub(cache_path=cache, port=dport, http_port=1, broadcast=[], scan=False)
        assert url2 == hub.url  # served from cache, no probe
    finally:
        r.stop(); hub.stop()


def test_oldest_hub_wins_so_all_clients_agree():
    infos = [{"url": "http://b:5000", "started_at": 200.0}, {"url": "http://a:5000", "started_at": 100.0},
             {"url": "http://c:5000", "started_at": 300.0}]
    assert d._pick(infos) == "http://a:5000" and d._pick([]) is None


def test_hub_requiring_api_key_is_still_recognised():
    import threading
    from werkzeug.serving import make_server
    srv = make_server("127.0.0.1", 0, create_app(HubCore(), api_key="s3cret"), threaded=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        info = d.check_hub(f"http://127.0.0.1:{srv.server_port}")
        assert info is not None
    finally:
        srv.shutdown()


def test_non_hub_web_servers_are_not_mistaken_for_the_hub():
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok": true}')
        def log_message(self, *a): pass
    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        assert d.check_hub(f"http://127.0.0.1:{srv.server_port}") is None
    finally:
        srv.shutdown()


def test_hublink_finds_hub_by_itself_and_delivers():
    hub, dport = RunningHub(), next_port()
    r = start_responder(hub, dport)
    try:
        link = HubLink(None, "camX", log=lambda *_: None,
                       discovery=dict(cache_path=tmp_cache(), port=dport, http_port=1,
                                      broadcast=["127.0.0.1"], scan=False)).start()
        assert link.base == hub.url and link.online
        t = time.time()
        link.send_rep(judgment(t, t + 2), "p1", 1, "squat")
        assert link.flush()
        assert hub.core.patient_summary("p1")["exercises"]["squat"]["total_reps"] == 1
        link.close()
    finally:
        r.stop(); hub.stop()


def test_hublink_with_a_wrong_address_still_connects():
    hub, dport = RunningHub(), next_port()
    r = start_responder(hub, dport)
    try:
        link = HubLink("http://HUB:5000", "camX", log=lambda *_: None,
                       discovery=dict(cache_path=tmp_cache(), port=dport, http_port=1,
                                      broadcast=["127.0.0.1"], scan=False)).start()
        assert link.base == hub.url and link.online
        link.close()
    finally:
        r.stop(); hub.stop()


def test_hublink_rediscovers_when_the_hub_moves_and_loses_nothing():
    dport = next_port()
    core = HubCore()
    hub1 = RunningHub(core=core)
    r1 = start_responder(hub1, dport)
    cache = tmp_cache()
    link = HubLink(None, "camX", log=lambda *_: None, timeout=0.5,
                   discovery=dict(cache_path=cache, port=dport, http_port=1,
                                  broadcast=["127.0.0.1"], scan=False, udp_timeout=1.0)).start()
    assert link.base == hub1.url
    t = time.time()
    link.send_rep(judgment(t, t + 2), "p1", 1, "squat")
    r1.stop(); hub1.stop(); time.sleep(0.8)  # hub goes away...
    link.send_rep(judgment(t + 3, t + 5), "p1", 1, "squat")  # ...events queue up
    assert link.flush() is False and link.pending() >= 1
    hub2 = RunningHub(core=core)  # ...and returns on a NEW port
    r2 = start_responder(hub2, dport)
    try:
        assert hub2.port != hub1.port
        link._last_discover = 0.0
        assert link.discover() is True and link.base == hub2.url
        assert link.flush() is True and link.pending() == 0
        assert core.patient_summary("p1")["exercises"]["squat"]["total_reps"] == 2
    finally:
        r2.stop(); hub2.stop()


def test_a_laptop_becomes_the_hub_when_none_exists_and_others_find_it():
    dport = next_port()
    disc = dict(cache_path=tmp_cache(), port=dport, http_port=1, broadcast=["127.0.0.1"],
                scan=False, udp_timeout=0.5)
    first = HubLink(None, "lap1", log=lambda *_: None, discovery=dict(disc))
    assert first.discover(force=True) is False
    hosted = host_if_alone(first, port=0, db=":memory:", discovery_port=dport, log=lambda *_: None)
    try:
        assert hosted is not None and first.base == hosted.url_local
        second = HubLink(None, "lap2", log=lambda *_: None, discovery=dict(disc, cache_path=tmp_cache()))
        assert second.discover(force=True) is True
        assert second.base.endswith(f":{hosted.port}")
        third = HubLink(None, "lap3", log=lambda *_: None, discovery=dict(disc, cache_path=tmp_cache()))
        assert host_if_alone(third, port=0, db=":memory:", discovery_port=dport, log=lambda *_: None) is None
        assert third.base == second.base  # joined, did not host a second hub
    finally:
        hosted.stop()


def test_nothing_on_the_network_never_raises_or_hangs():
    t0 = time.time()
    link = HubLink(None, "lonely", log=lambda *_: None,
                   discovery=dict(cache_path=tmp_cache(), port=next_port(), http_port=1,
                                  broadcast=["127.0.0.1"], scan_hosts=["127.0.0.1"], udp_timeout=0.4))
    link.start()
    assert link.base is None and link.online is False
    link.send_rep(judgment(1, 3), "p1", 1, "squat")
    assert link.flush() is False and link.pending() == 1
    link.close(flush_timeout=0.3)
    assert time.time() - t0 < 15


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print(f"PASS  {name}")
            except AssertionError as e:
                failed += 1; print(f"FAIL  {name}: {e}")
            except Exception as e:
                import traceback; traceback.print_exc()
                failed += 1; print(f"ERROR {name}: {type(e).__name__}: {e}")
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED")
    sys.exit(1 if failed else 0)
