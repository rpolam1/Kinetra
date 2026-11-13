"""Checks whether a hub can be found from this computer, and can open the Windows firewall for it."""
import argparse
import os
import subprocess
import sys

# The parent folder is added so the formcheck package can be imported when this is run directly
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from formcheck import discovery as d


def fix_firewall():
    """Add Windows firewall rules for the hub's web and discovery ports. Needs an administrator shell."""
    if not sys.platform.startswith("win"):
        print("Firewall helper is for Windows only. On Linux: sudo ufw allow 5000/tcp && sudo ufw allow 5001/udp")
        return
    rules = [("ExerciseHub TCP", "TCP", d.DEFAULT_HTTP_PORT), ("ExerciseHub discovery UDP", "UDP", d.DISCOVERY_PORT)]
    for name, proto, port in rules:
        subprocess.run(["netsh", "advfirewall", "firewall", "delete", "rule", f"name={name}"],
                       capture_output=True)
        r = subprocess.run(["netsh", "advfirewall", "firewall", "add", "rule", f"name={name}",
                            "dir=in", "action=allow", f"protocol={proto}", f"localport={port}",
                            "profile=any"], capture_output=True, text=True)
        print(("OK   " if r.returncode == 0 else "FAIL ") + f"{proto} {port}: "
              + (r.stdout.strip() or r.stderr.strip()))
    print("\nIf any rule FAILED, re-run this in PowerShell opened as Administrator.")


def main():
    """Try each way of finding a hub and print what worked, with hints when nothing did."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--fix-firewall", action="store_true")
    ap.add_argument("--hub", help="a specific address to test as well")
    args = ap.parse_args()
    if args.fix_firewall:
        return fix_firewall()

    print("This laptop's LAN addresses :", d.local_ips() or "NONE FOUND (not on a network?)")
    print("Broadcast targets           :", d.broadcast_addresses())
    print()
    if args.hub:
        url = d.normalize_url(args.hub)
        print(f"[explicit] {url}: ", "OK" if d.check_hub(url) else "no hub answering there")
    print("[localhost] ", "hub running on THIS machine" if d.check_hub(f"http://127.0.0.1:{d.DEFAULT_HTTP_PORT}")
          else "no hub on this machine")
    cached = d._load_cache(d.CACHE_FILE)
    print("[last known]", f"{cached}: " + ("OK" if cached and d.check_hub(cached) else "not reachable") if cached
          else "none saved yet")
    print("[broadcast ] probing (2 s)...")
    udp = d.probe_udp(2.0)
    print("             ", [i["url"] for i in udp] or "no answer (hub not running, firewall, or router blocks broadcast)")
    print("[subnet scan] scanning port 5000 on the local network...")
    scan = d.scan_subnet()
    print("             ", [i["url"] for i in scan] or "no answer")
    print()
    if udp or scan or d.check_hub(f"http://127.0.0.1:{d.DEFAULT_HTTP_PORT}"):
        print("RESULT: a hub IS reachable. Clients will find it automatically (no address needed).")
        if scan and not udp:
            print("Note: broadcast is blocked on this network, but the subnet scan works -- fine.")
        return
    print("RESULT: no hub found. Check, in order:")
    print("  1. Is a hub running?   On one laptop:  py -m server.hub      (or run clients with --auto-host)")
    print("  2. Hub laptop firewall (Windows):      py tools/hub_check.py --fix-firewall   (as Administrator)")
    print("  3. Same network?  Both laptops on the SAME Wi-Fi/router (not 'guest' Wi-Fi: it isolates devices).")
    print("  4. VPN / second adapter?  Turn off VPNs; on the hub laptop use the Wi-Fi/Ethernet address above.")


if __name__ == "__main__":
    main()
