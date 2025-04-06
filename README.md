# WireGuard Configuration Switcher

This Node.js script automatically switches between WireGuard configurations every 3 minutes on macOS.

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