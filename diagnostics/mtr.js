var spawn = require('child_process').spawn,
    ipaddr = require('ipaddr.js');

var command = 'mtr';

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
    
    var count = 10;
    //console.log(request.params);
    if (request.count && request.count > 0 && request.count < 101) {
        count = request.count;
    }

    var info = {start:new Date().getTime()};
    var mtr = spawn(command, ['-b','-w','-c '+count, targ]);

    var out = "", error = "";

    mtr.stdout.on('data', function(data){
        out += data;
    });

    mtr.stderr.on('data', function(data){
        error += data;
    });

    mtr.on('exit', function(code){
        //console.log("mtr",out, error, code);
        info.end = new Date().getTime();
        info.runtime = info.end - info.start;
        info.message = out;
        info.error = error;
        info.diag = "mtr";
        callback(info);
    });
};