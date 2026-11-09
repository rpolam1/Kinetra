import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from server import hub


class Patched:
    def __init__(self, target, **attrs):
        self.target, self.attrs, self.saved = target, attrs, {}

    def __enter__(self):
        for k, v in self.attrs.items():
            self.saved[k] = getattr(self.target, k)
            setattr(self.target, k, v)

    def __exit__(self, *exc):
        for k, v in self.saved.items():
            setattr(self.target, k, v)


def test_falls_back_to_the_default_browser_when_chrome_is_missing():
    opened = []
    with Patched(hub, _chrome_paths=lambda: ["/no/such/chrome"]), \
            Patched(hub.webbrowser, open=lambda url: opened.append(url) or True):
        hub.open_in_browser("http://localhost:5000")
    assert opened == ["http://localhost:5000"]


def test_uses_chrome_when_it_exists():
    calls = []

    class Fake:
        def open(self, url):
            calls.append(url)
            return True

    with tempfile.TemporaryDirectory() as d:
        fake = os.path.join(d, "chrome")
        open(fake, "w").close()
        with Patched(hub, _chrome_paths=lambda: [fake]), \
                Patched(hub.webbrowser, register=lambda *a, **k: None, get=lambda name: Fake(),
                        open=lambda url: calls.append("default")):
            hub.open_in_browser("http://localhost:5000")
    assert calls == ["http://localhost:5000"]
