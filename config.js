var config = {
    "check_id": "<Your NodePing Check ID>",
    "check_token": "<Your NodePing Check Token>",
    "NodePingAgent_enabled": false,
    "check_interval": 1,
    "nodepath": "/usr/local/bin/node",
    "NodePingAgent_path": "/home/youruser/NodePing_Agent",
    "NodePingAgent_logpath": "/home/youruser/NodePing_Agent/log/NodePingAgent.log",
    "heartbeathandler": {
        "host": "push.nodeping.com",
        "port": "443",
        "path": "/",
        "name": "NodePingPush"
    },
    "diagnosticserver": {
        "host": "diag.nodeping.com",
        "port": "3030"
    },
    "plugins": {},
    "checklist": {}
};
for(var i in config){
    exports[i] = config[i];
};
