var spawn = require('child_process').spawn,
    ipaddr = require('ipaddr.js');

var diagRun = exports.diagRun = function(request, callback){
    var pingcommand = 'ping';
    var targ = request.diagtarget;
    if (!targ) {
        return callback({error:"target missing"});
    }
    if (!ipaddr.IPv6.isValid(targ) && !ipaddr.IPv4.isValid(targ)) {
        if(!targ.match(/^[\w\.\-]+$/)){
            return callback({error:"Invalid target - not a valid IP address or hostname"});
        }
    } else if (ipaddr.IPv6.isValid(targ)){
        pingcommand = 'ping6';
    }
    var count = (request.count) ? parseInt(request.count) : 10;
    if (count > 30) {
        count = 30;
    }
    var info = {start:new Date().getTime()};
    var ping = spawn(pingcommand, ['-c '+count.toString(), targ]);

    var out = "", error = "";

    ping.stdout.on('data', function(data) {
        out += data;
    });

    ping.stderr.on('data', function(data) {
        error += data;
    });

    ping.on('exit', function(code) {
        // console.log("Ping",out, error, code);
        info.end = new Date().getTime();
        info.runtime = info.end - info.start;
        info.message = out;
        info.error = error;
        info.diag = "ping";
        callback(info);
    });
};