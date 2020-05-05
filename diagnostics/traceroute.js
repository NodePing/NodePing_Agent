var spawn = require('child_process').spawn,
    ipaddr = require('ipaddr.js');

var command = 'traceroute';

var diagRun = exports.diagRun = function(request, callback){
    var targ = request.diagtarget;
    if (!targ) {
        return callback({error:"target missing"});
    }
    if (!ipaddr.IPv6.isValid(targ) && !ipaddr.IPv4.isValid(targ)) {
        if(!targ.match(/^[\w\.\-]+$/)){
            return callback({error:"Invalid target - not a valid IP address or hostname"});
        }
    }
    var info = {start:new Date().getTime()};
    var trace = spawn(command, ['-q 1', targ]);

    var out = "", error = "";

    trace.stdout.on('data', function(data){
        out += data;
    });

    trace.stderr.on('data', function(data){
        error += data;
    });

    trace.on('exit', function(code){
        //console.log("Traceroute",out, error, code);
        info.end = new Date().getTime();
        info.runtime = info.end - info.start;
        info.message = out;
        info.error = error;
        info.diag = "traceroute";
        callback(info);
    });
};