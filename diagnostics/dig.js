var spawn = require('child_process').spawn,
    ipaddr = require('ipaddr.js');

var command = 'dig';

var diagRun = exports.diagRun = function(request, callback) {
    var targ = request.diagtarget;
    if (!targ) {
        return callback({error:"target missing"});
    }
    if (!ipaddr.IPv6.isValid(targ) && !ipaddr.IPv4.isValid(targ)) {
        if (!targ.match(/^[\w\.\-]+$/)) {
            return callback({error:"Invalid target - not a valid IP address or hostname"});
        }
    }
    
    var source = '8.8.8.8';
    var type = 'A';
    var transport = '+notcp';
    //console.log(request.params);
    if (request.dnsserver) {
        var source = request.dnsserver;
        if (!ipaddr.IPv6.isValid(source) && !ipaddr.IPv4.isValid(source)) {
            if (!source.match(/^[\w\.\-]+$/)) {
                return callback({error:"Malformed DNS server address"});
            }
        }
    }
    if (request.dnstype) {
        var rtype = request.dnstype.toUpperCase();
        if (['A','AAAA','ANY','CNAME','MX','NS','PTR','SOA','TXT'].indexOf(rtype) > -1) {
            type = rtype;
        }
    }

    if (request.transport && request.transport === 'tcp') {
        transport = '+tcp';
    }

    var info = {start:new Date().getTime()};
    var dig = spawn('dig', ['@'+source,'-t'+type,'-q', targ, '+besteffort', '+tries=1', transport]);

    var out = "", error = "";

    dig.stdout.on('data', function(data) {
        out += data;
    });

    dig.stderr.on('data', function(data) {
        error += data;
    });

    dig.on('exit', function(code) {
        //console.log("dig",out, error, code);
        info.end = new Date().getTime();
        info.runtime = info.end - info.start;
        info.message = out;
        info.error = error;
        info.diag = "dig";
        callback(info);
    });
};