# Kinetra Jetson Setup

Assumes the Jetson has not been reflashed. Replace `jetson` with your own username and hostname if they differ.

Repo: `https://github.com/elliottstarosta/ECE-198-Capstone`
Script on your laptop: `C:\Users\starl\OneDrive\Documents\GitHub\ECE 198\kinetra-jetson.sh`

---

## A. At the Jetson (monitor and keyboard, one time)

### 1. Log in
Use whatever account exists. If you do not know the password, reflash the Jetson instead.

### 2. Check what you have
```
cat /etc/os-release
python3 --version
df -h /
```
You want Ubuntu 22.04, Python 3.9 or newer and at least 10 GB free. If not, reflash.

### 3. Look for leftovers
```
systemctl list-unit-files --state=enabled
ps aux --sort=-%mem | head -15
crontab -l
sudo ss -ltnp | grep 5000
```
Disable anything old you do not need:
```
sudo systemctl disable --now NAME
```
Port 5000 must be free because the hub uses it.

### 4. Create your user and name the machine
```
sudo adduser jetson
sudo usermod -aG sudo,video jetson
sudo hostnamectl set-hostname jetson
```
Log out and log back in as `jetson`. Change the old account password with `passwd`.

### 5. Connect to Wi-Fi (or plug in Ethernet)
```
nmcli device wifi list
sudo nmcli device wifi connect "YourWifiName" password "YourPassword"
```

### 6. Save your phone hotspot as a backup
Turn the hotspot on, then:
```
sudo nmcli device wifi connect "YourPhoneName" password "HotspotPassword"
```
Prefer the main network:
```
sudo nmcli connection modify "YourWifiName" connection.autoconnect-priority 10
```

### 7. Plug in the USB camera
```
ls /dev/video*
```
You should see `/dev/video0`.

### 8. Note the IP and enable SSH
```
hostname -I
sudo systemctl enable --now ssh
```
Write down the first address. You can now unplug the monitor and keyboard.

---

## B. From your laptop (PowerShell)

### 9. Test the connection
```
ssh jetson@jetson.local
```
Use the IP from step 8 if the name does not resolve. Type `exit` to come back.

### 10. Set up key login (no password prompts)
```
ssh-keygen -t ed25519
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh jetson@jetson.local "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

### 11. Copy the script to the Jetson
```
scp "C:\Users\starl\OneDrive\Documents\GitHub\ECE 198\kinetra-jetson.sh" jetson@jetson.local:~
```

### 12. Run the script
```
ssh -t jetson@jetson.local "sed -i 's/\r$//' kinetra-jetson.sh && bash kinetra-jetson.sh https://github.com/elliottstarosta/ECE-198-Capstone.git"
```
The first run installs everything and builds the web app, so it takes a while.

If the repo is private, the script prints a deploy key. Add it on GitHub under the repo Settings, then Deploy keys. Run again with the ssh address:
```
ssh -t jetson@jetson.local "bash kinetra-jetson.sh git@github.com:elliottstarosta/ECE-198-Capstone.git"
```

The script installs git, Python, Node and the other dependencies, clones the repo to `~/Kinetra`, builds the Python environment, generates the hub API key, builds the web app, and creates the hub and camera services that start at boot.

---

## C. Check it works

### 13. Open the web app
In your laptop browser: `http://jetson.local:5000` (or the Jetson IP with `:5000`), then sign in. Both devices must be on the same network, and the laptop needs internet for Firebase sign-in.

### 14. Reboot test
```
ssh jetson@jetson.local "sudo reboot"
```
Wait a minute or two and confirm the page comes back on its own.

### 15. Logs if something is wrong
```
ssh jetson@jetson.local "journalctl -u kinetra-hub -n 50"
ssh jetson@jetson.local "journalctl -u kinetra-camera -n 50"
```

---

## D. Updating the code later

Push to GitHub, then:
```
ssh -t jetson@jetson.local kinetra-setup
```
It pulls the latest code, reinstalls requirements, rebuilds the web app and restarts both services.

---

## Handy commands

| Task | Command |
| --- | --- |
| Hub status | `systemctl status kinetra-hub` |
| Camera status | `systemctl status kinetra-camera` |
| Restart both | `sudo systemctl restart kinetra-hub kinetra-camera` |
| Follow hub log | `journalctl -u kinetra-hub -f` |
| Follow camera log | `journalctl -u kinetra-camera -f` |
| Show the hub API key | `sudo cat /etc/kinetra.env` |
| Web build settings | `~/kinetra-config/web.env` |
| Hub database | `~/kinetra-data/hub.db` |

## If it will not connect

- **Not on the same network:** the laptop and Jetson must share a network. Some school or public Wi-Fi blocks devices from seeing each other. Use a phone hotspot or your own router.
- **jetson.local does not work:** use the Jetson IP from `hostname -I`.
- **No Wi-Fi at boot:** plug in Ethernet or turn on the saved phone hotspot.
- **Sign-in fails in the browser:** in the Firebase console, open Authentication, Settings, Authorized domains, and add the address you browse to (a name such as `jetson.local` works better than a raw IP).
- **Camera service keeps restarting:** check `ls /dev/video*` and the camera log.
- **Script fails with `\r: command not found`:** the file has Windows line endings. The `sed` in step 12 fixes this.
- **Do not commit** `kinetra-jetson.sh` to the repo. It contains your Firebase values.