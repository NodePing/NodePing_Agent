# NodePing AGENT software

Software to run a **NodePing** AGENT check on Linux devices. It has been tested on Ubuntu and Raspian and requires node.js v10 or higher. It can optionally provide the diagnostics client if you'd like to run diagnostics from NodePing's UI or API on your AGENT.

## NodePing AGENT checks

Create an AGENT check when you want your own NodePing probe behind your firewall or in your internal network that you can assign other NodePing checks to run on.

Please see the full documentation for the AGENT check at <https://nodeping.com/agent_check.html>

If you don't yet have a **NodePing** account, you can sign up for a free 15-day trial at <https://nodeping.com/>

## AGENT Heartbeat

The AGENT software sends a heartbeat HTTPS request to NodePing each check interval. You can configure the AGENT check to optionally alert you when that heartbeat doesn't happen.

## Runs Checks

In response to the heartbeat, NodePing will reply with a list of other NodePing checks that you have assigned to run on the AGENT.  You assign or modify checks to run on your agents using either NodePing's web site or API.

## Requirements

All servers running AGENT software will need node.js installed and accessible to the user running the AGENT software.  We recommend the lastest stable release. <https://nodejs.org/en/download/>

The AGENT needs to run under a user with read and write access to its own directory, the ability to add cron jobs, access to the network, and depending on the check types you want to enable possibly access to the packages listed below.  We suggest running the AGENT under its own user with restricted access to anything else on the host.

Depending on the check types running on the AGENT, you'll need the following installed on the server running the AGENT software using your OS package manager:

* AUDIO - if using the volume detection feature you'll need to install 'ffmpeg'
* PING - 'ping' must be installed and able to be run by the user that runs the AGENT software

## SSH checks with local keys

The SSH check in the AGENT supports using local SSH keys for authentication. Set the 'sshkey' element in the NodePing SSH check to a 5-character, upper-case string (example: "PHYNW").  You can do that using the API. In the AGENT config.json file, add an object entry for that sshkey string with a value of the full path of the SSH key file.

Example of config.json that has a local SSH key configured

``` json
{
    "check_id": "<Your NodePing Check ID>",
    "check_token": "<Your NodePing Check Token>",
    "check_enabled": true,
    "node_path": "/usr/local/bin/node",
    "agent_path": "/home/youruser/NodePing_Agent",
    "agent_logpath": "/home/youruser/NodePing_Agent/log/NodePingAgent.log",
    "sshkeys": {"PHYNW":"/home/youruser/.ssh/id_rsa"},
    "plugins": {}
}
```

## Installation

1. Create the AGENT check in NodePing using the web UI or the API.  Make note of the check ID and the check token that is generated. You can find that info in the check drawer by clicking on the check label.
2. Clone this repo or copy the files to the server you want to run the AGENT check. The home folder of the user you want to run it as is usually appropriate.

cd into the directory where you

`~$ cd NodePing_Agent`

Run an `npm install` to get all the node dependencies. Note that if you use the check types mentioned above you will need to have already installed the external dependencies.

`~/NodePing_Agent$ npm install`

Run the NodePingAgent.js with the install argument along with your check ID and check token

``` sh
~/NodePing_Agent$ node NodePingAgent.js install 202002241738UUL8O-0BYZ5Z8F MXNVTSTW-8H0L-4OPE-8C7O-XHNTTX2HPEVO
2020-02-24T21:12:41.512Z Info :NodePingAgent installing NodePingAgent
2020-02-24T21:12:41.552Z Info: NodePingAgent setting checkid = 202002241738UUL8O-0BYZ5Z8F, token = MXNVTSTW-8H0L-4OPE-8C7O-XHNTTX2HPEVO, and interval = 1
2020-02-24T21:12:41.778Z Info: NodePingAgent crontab installed and enabled for every 1 minutes.
```


The AGENT software will install itself as a crontab for the user that ran the install.

You'll probably want to add log rotation so the AGENT doesn't fill up your partitions.

`~/NodePing_Agent$ sudo nano /etc/logrotate.d/NodePing_Agent`

Add the following to the log rotate file.

``` sh
/home/<youruser>/NodePing_Agent/log/*.log {
        daily
        missingok
        rotate 10
        compress
        delaycompress
        notifempty
}
```

You should now be able to assign other NodePing checks to this AGENT and they'll run from this server.

## Test

To see what the AGENT would send as a heartbeat to NodePing, run it with the test argument:

``` sh
~/NodePing_Agent$ node NodePingAgent.js test
2020-02-24T21:33:24.615Z Info: NodePingAgent data: {
  npcheckclock: { start: 1582580004615, end: 1582580004615 },
  checkcount: 5
}
2020-02-24T21:33:24.618Z Info: Not posting anything to NodePing.
```

This output says there are 5 checks currently configured to run on this AGENT.

## Disable

To disable the AGENT software:

``` sh
~/NodePing_Agent$ node NodePingAgent.js disable
2020-02-24T21:24:09.698Z *** WARNING *** NodePingAgent disabled in ./config.js
2020-02-24T21:24:09.739Z Info: NodePingAgent disabling NodePingAgent
2020-02-24T21:24:09.889Z Info: NodePingAgent crontab removed
2020-02-24T21:24:09.895Z Info: NodePingAgent disabled
```


## Enable

If disabled, to re-enable the AGENT software:

``` sh
~/NodePing_Agent$ node NodePingAgent.js enable
2020-02-24T21:25:15.753Z *** WARNING *** NodePingAgent disabled in ./config.js
2020-02-24T21:25:15.794Z Info: NodePingAgent enabling NodePingAgent
2020-02-24T21:25:15.954Z Info: NodePingAgent crontab installed and enabled for every 1 minutes.
```

## Remove

To completely remove the AGENT software and its log files:

``` sh
~/NodePing_Agent$ node NodePingAgent.js remove
2020-02-24T21:26:22.393Z *** WARNING *** NodePingAgent disabled in ./config.js
2020-02-24T21:26:22.433Z Info: NodePingAgent removing NodePingAgent
2020-02-24T21:26:22.585Z Info: NodePingAgent crontab removed
2020-02-24T21:26:22.997Z Info: NodePingAgent files removed
```

This removes the entire NodePing_Agent directory and the crontab line.

## Diagnostics

If you would like to run on-demand diagnostics on your AGENT, you'll need to start up the diagnostics client software. It's separate from the AGENT cron run.

The diagnostics client is a node.js script that uses websockets to connect to NodePing's diagnostics servers (on port 3030) to provide immediate diagnostics on your AGENT.

You can start the diagnostics client on command line with:

``` sh
~/NodePing_Agent$ node DiagnosticsClient.js >>log/DiagnosticsClient.log 2>&1 &
```

Diagnostics can be run from the NodePing web UI <https://nodeping.com/> - Diagnostic Tools tab (choose your AGENT check in the location dropdown) or via the API <https://nodeping.com/docs-api-diagnostics.html> - specify your AGENT check ID as the location.

## Support

If you have questions about how to use the AGENT software, please contact us at support@nodeping.com or create an issue on GitHub.

## Contributions

Found a bug? New feature? Send it to us!
We encourage pull requests for the AGENT software, documentation, all of it. We appreciate your contributions.

## Terms and Licensing
Use of this software is subject to the [LICENSE](LICENSE) and the NodePing Terms of Service (<https://nodeping.com/TermsOfService>).

copyright NodePing LLC 2020
