import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

DISCOVERY_PORT = 5001
DEFAULT_HTTP_PORT = 5000
MAGIC = "exercise-hub-v1"
CACHE_FILE = ".hub_url"
HUB_HEADER = "X-Hub"


def local_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # no packet is sent; picks the LAN interface
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        ips.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith(("127.", "169.254.", "0.")))


def broadcast_addresses():
    addrs = ["255.255.255.255"]
    for ip in local_ips():
        addrs.append(ip.rsplit(".", 1)[0] + ".255")
    return list(dict.fromkeys(addrs))


def normalize_url(text, default_port=DEFAULT_HTTP_PORT):
    text = (text or "").strip().rstrip("/")
    if not text:
        return None
    if "://" not in text:
        text = "http://" + text
    host_part = text.split("://", 1)[1]
    if ":" not in host_part:
        text += f":{default_port}"
    return text


def check_hub(url, timeout=1.0):
    try:
        with urllib.request.urlopen(url.rstrip("/") + "/api/health", timeout=timeout) as r:
            if r.headers.get(HUB_HEADER) != "exercise-hub":
                return None
            body = json.loads(r.read().decode() or "{}")
            return {"url": url.rstrip("/"), "name": body.get("name"),
                    "started_at": body.get("started_at", 0.0), "auth": False}
    except urllib.error.HTTPError as e:
        if e.code == 401 and e.headers.get(HUB_HEADER) == "exercise-hub":
            return {"url": url.rstrip("/"), "name": None, "started_at": 0.0, "auth": True}
        return None
    except Exception:
        return None


class DiscoveryResponder(threading.Thread):

    def __init__(self, http_port=DEFAULT_HTTP_PORT, name=None, started_at=None,
                 port=DISCOVERY_PORT):
        super().__init__(daemon=True)
        self.http_port = http_port
        self.name_ = name or socket.gethostname()
        self.started_at = started_at or time.time()
        self.port = port
        self.error = None
        self._stop_evt = threading.Event()
        self._sock = None

    def run(self):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("", self.port))
            s.settimeout(0.5)
            self._sock = s
        except OSError as e:
            self.error = e
            return
        reply = json.dumps({"magic": MAGIC, "type": "hub", "name": self.name_,
                            "http_port": self.http_port, "started_at": self.started_at}).encode()
        while not self._stop_evt.is_set():
            try:
                data, addr = s.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                msg = json.loads(data.decode())
            except Exception:
                continue
            if msg.get("magic") == MAGIC and msg.get("type") == "probe":
                try:
                    s.sendto(reply, addr)
                except OSError:
                    pass
        s.close()

    def stop(self):
        self._stop_evt.set()


def probe_udp(timeout=2.0, port=DISCOVERY_PORT, broadcast=None):
    found = {}
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.settimeout(0.2)
    probe = json.dumps({"magic": MAGIC, "type": "probe"}).encode()
    targets = broadcast if broadcast is not None else broadcast_addresses()
    deadline = time.time() + timeout
    next_send = 0.0
    try:
        while time.time() < deadline:
            if time.time() >= next_send:  # resend a few times: UDP can drop
                for addr in targets:
                    try:
                        s.sendto(probe, (addr, port))
                    except OSError:
                        pass
                next_send = time.time() + 0.6
            try:
                data, (ip, _) = s.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                msg = json.loads(data.decode())
            except Exception:
                continue
            if msg.get("magic") == MAGIC and msg.get("type") == "hub":
                url = f"http://{ip}:{msg.get('http_port', DEFAULT_HTTP_PORT)}"
                found[url] = {"url": url, "name": msg.get("name"),
                              "started_at": msg.get("started_at", 0.0), "auth": None}
    finally:
        s.close()
    return sorted(found.values(), key=lambda i: i["started_at"])


def scan_subnet(port=DEFAULT_HTTP_PORT, timeout=0.5, hosts=None):
    if hosts is None:
        hosts = []
        for ip in local_ips():
            base = ip.rsplit(".", 1)[0]
            hosts.extend(f"{base}.{i}" for i in range(1, 255))
        hosts = list(dict.fromkeys(hosts))
    if not hosts:
        return []

    def probe(host):
        try:
            with socket.create_connection((host, port), timeout=timeout):
                pass
        except OSError:
            return None
        return check_hub(f"http://{host}:{port}", timeout=1.0)

    with ThreadPoolExecutor(max_workers=64) as ex:
        results = [r for r in ex.map(probe, hosts) if r]
    return sorted(results, key=lambda i: i["started_at"])


def _pick(infos):
    return sorted(infos, key=lambda i: (i.get("started_at") or 0.0, i["url"]))[0]["url"] if infos else None


def find_hub(preferred=None, cache_path=CACHE_FILE, port=DISCOVERY_PORT,
             http_port=DEFAULT_HTTP_PORT, broadcast=None, scan_hosts=None, scan=True,
             udp_timeout=2.0, log=None):
    say = log or (lambda *_: None)

    def verified(url, how):
        info = check_hub(url)
        if info:
            say(f"hub found via {how}: {url}")
            _save_cache(cache_path, url)
            return url
        return None

    if preferred and preferred != "auto":
        url = normalize_url(preferred, http_port)
        if url and verified(url, "explicit address"):
            return url
        say(f"'{preferred}' is not reachable -- searching the network instead")

    env = os.environ.get("HUB_URL")
    if env:
        url = normalize_url(env, http_port)
        if url and verified(url, "HUB_URL"):
            return url

    cached = _load_cache(cache_path)
    if cached and verified(cached, "last known hub"):
        return cached

    local = f"http://127.0.0.1:{http_port}"
    info = check_hub(local)
    if info:
        say(f"hub found on this machine: {local}")
        _save_cache(cache_path, local)
        return local

    infos = probe_udp(udp_timeout, port, broadcast)
    if infos:
        url = _pick(infos)
        say(f"hub found via network broadcast: {url}")
        _save_cache(cache_path, url)
        return url

    if scan:
        say("broadcast got no answer; scanning the local subnet...")
        infos = scan_subnet(http_port, hosts=scan_hosts)
        if infos:
            url = _pick(infos)
            say(f"hub found via subnet scan: {url}")
            _save_cache(cache_path, url)
            return url
    return None


def _save_cache(path, url):
    if not path:
        return
    try:
        with open(path, "w") as f:
            f.write(url)
    except OSError:
        pass


def _load_cache(path):
    try:
        with open(path) as f:
            return f.read().strip() or None
    except OSError:
        return None
