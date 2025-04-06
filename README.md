# WireGuard Configuration Switcher

Finally, I managed to create an application that allows me to change my IP using WireGuard VPNs every 3 minutes. This program randomly switches between configurations and displays the IP address along with the city and country information in the application. DNS Leak protection will be added soon. I started with a simple interface but later improved it for better visualization. Currently, it has only been tested on Mac M series computers.

This project was created by reusing and adapting various Linux scripts that I used for automating WireGuard on Linux [Wireguard Toolkit](https://github.com/4rji/Wireguard-Management).

This Node.js script automatically switches between WireGuard configurations every 3 minutes on macOS.


![Image](https://github.com/user-attachments/assets/f50f1a41-c4f4-4927-aeb9-6db23f30e178)



## Prerequisites

1. Node.js installed on your system
2. WireGuard installed and configured on your macOS
3. WireGuard configuration files (.conf) in the `/etc/wireguard` directory

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

1. Make sure your WireGuard configuration files are in the `/etc/wireguard` directory
2. Start the script:
   ```bash
   npm start
   ```

The script will:
- Run immediately on startup
- Switch configurations every 3 minutes
- Log all activities to the console

## Configuration

You can modify the following variables in `index.js`:
- `CONFIG_DIR`: Directory containing your WireGuard configuration files
- `SWITCH_INTERVAL`: Cron expression for switching interval (default: every 3 minutes)

## Running as a Service

To run this script as a service on macOS, you can use `launchd`. Create a plist file in `~/Library/LaunchAgents/`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.wireguard.switcher</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/your/script/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Then load the service:
```bash
launchctl load ~/Library/LaunchAgents/com.wireguard.switcher.plist
```