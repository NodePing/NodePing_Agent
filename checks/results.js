/*
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * results.js
 * Accepts check results, pushes results to NodePing and schedules the next check run.
 */

var config = require('../config'),
    sys = require("util"),
    querystring = require('querystring'),
    agent = require('https'),
    path = require('path'),
    fs = require('fs'),
    os = require('os'),
    nputil = require('../nputil');

exports.process = function(jobinfo, override) {
    //console.log(new Date(),'info','results: job: '+sys.inspect(jobinfo));
    if (!jobinfo._id && jobinfo.jobid) {
        jobinfo._id = jobinfo.jobid;
    }
    if (!jobinfo._id) {
        console.log(new Date(),'error','results: Malformed job - no _id '+sys.inspect(jobinfo));
        return false;
    }
    if (jobinfo._id == 'undefined') {
        console.log(new Date(),'error','results: Malformed job - id is undefined '+sys.inspect(jobinfo));
        return false;
    }
    if (!jobinfo.results) {
        console.log(new Date(),'error','results: Malformed job - no results '+sys.inspect(jobinfo));
        return false;
    }
    if (nputil.gettype(jobinfo.results) == 'string') {
        try {
            jobinfo.results = JSON.parse(jobinfo.results);
            if(nputil.gettype(jobinfo.notifications) == 'string'){
                jobinfo.notifications = JSON.parse(jobinfo.notifications);
            }
            if(nputil.gettype(jobinfo.parameters) == 'string'){
                jobinfo.parameters = JSON.parse(jobinfo.parameters);
            }
            if(nputil.gettype(jobinfo.location) == 'string'){
                jobinfo.location = JSON.parse(jobinfo.location);
            }
            if(nputil.gettype(jobinfo.runlocations) == 'string'){
                jobinfo.runlocations = JSON.parse(jobinfo.runlocations);
            }
            if(nputil.gettype(jobinfo.interval) == 'string'){
                jobinfo.interval = parseFloat(jobinfo.interval);
                console.log(new Date(),'error','results: Malformed job - interval is now '+sys.inspect(jobinfo.interval));
            }
            if(nputil.gettype(jobinfo.runat) == 'string'){
                jobinfo.runat = parseInt(jobinfo.runat);
            }
            if(nputil.gettype(jobinfo.modified) == 'string'){
                jobinfo.modified = parseInt(jobinfo.modified);
            }
            if(jobinfo.hasOwnProperty('firstdown') && nputil.gettype(jobinfo.firstdown) == 'string'){
                jobinfo.firstdown = parseInt(jobinfo.firstdown);
            }
        } catch (jsonerror) {
            console.log(new Date(),'error','results: Malformed job - json error on transform '+sys.inspect(jobinfo));
            return false;
        }
    }
    if (!jobinfo.results.start) {
        console.log(new Date(),'error','results: Malformed job - no results start '+sys.inspect(jobinfo));
        return false;
    } else if(!jobinfo.results.end) {
        console.log(new Date(),'error','results: Malformed job no results end '+sys.inspect(jobinfo));
        return false;
    } else if(!jobinfo.results.hasOwnProperty('success')) {
        console.log(new Date(),'error','results: Malformed job no results success '+sys.inspect(jobinfo));
        return false;
    }
    if (jobinfo.hasOwnProperty('toIP')) {
        delete jobinfo.toIP;
    }
    if (jobinfo.parameters && jobinfo.parameters.targetip) {
        delete jobinfo.parameters.targetip;
    }
    if (jobinfo.redirectcount) {
        delete jobinfo.redirectcount;
    }
    if (jobinfo.redirecttarget) {
        delete jobinfo.redirecttarget;
    }
    if (jobinfo.redirectstart) {
        delete jobinfo.redirectstart;
    }
    var tryMe = 2;
    if (jobinfo.parameters && jobinfo.parameters.hasOwnProperty('sens')) {
        tryMe = parseInt(jobinfo.parameters.sens);
    }
    var upOrDown = (jobinfo.results.success) ? 'up' : 'down';
    if (override || tryMe < 1) {
        finalize(jobinfo);
        return true;
    }
    if (!jobinfo.hasOwnProperty('state') && jobinfo.hasOwnProperty('lastresult')) {
        jobinfo.state = (jobinfo.lastresult == 'false') ? 0 : 1;
    }
    if (jobinfo.lastresult) delete jobinfo.lastresult;
    if (!jobinfo.hasOwnProperty('state') ){
        // First run - need to recheck and verify
        if (jobinfo.retry) {
            if (jobinfo.results.success) {
                if (!jobinfo.newpass) {
                    jobinfo.newpass = 0;
                }
                //jobinfo.newfail = 0;
                jobinfo.newpass++;
            } else {
                if (!jobinfo.newfail) {
                    jobinfo.newfail = 0;
                }
                //jobinfo.newpass = 0;
                jobinfo.newfail++;
            }
            //console.log(new Date(),'info','results: New job retry: '+sys.inspect(jobinfo));
            if (jobinfo.newpass > tryMe || jobinfo.newfail > tryMe) {
                console.log(new Date(),'info','results: We retried new job '+jobinfo.retry+' times - declaring '+jobinfo._id+' '+upOrDown);
                delete jobinfo.newpass;
                delete jobinfo.newfail;
                finalize(jobinfo);
            } else {
                jobinfo.retry++;
                console.log(new Date(),'info','results: Retest #'+jobinfo.retry+' before declaring new job '+jobinfo._id+' '+upOrDown);
                recheck(jobinfo);
            }
        } else {
            jobinfo.retry = 1;
            if (jobinfo.results.success) {
                jobinfo.newpass = 1;
            } else {
                jobinfo.newfail = 1;
            }
            console.log(new Date(),'info','results: Retesting new job '+jobinfo._id);
            recheck(jobinfo);
        }
    } else {
        var mylastresult = true;
        if (!jobinfo.state ||  jobinfo.state == 'false' || jobinfo.state === '0') {
            mylastresult = false;
        }
        if (jobinfo.hasOwnProperty('retry')) {
            if (jobinfo.results.success != mylastresult) {
                if (jobinfo.retry >= tryMe) {
                    console.log(new Date(),'info','results: We retried '+jobinfo.retry+' times - declaring '+jobinfo._id+' '+upOrDown);
                    //console.log(new Date(),'info',"results: Processing 2");
                    finalize(jobinfo);
                } else {
                    jobinfo.retry++;
                    console.log(new Date(),'info','results: Retest #'+jobinfo.retry+' before declaring '+jobinfo._id+' '+upOrDown);
                    recheck(jobinfo);
                    //setTimeout((function(){checkthis(jobinfo);}), 30000); // 30 second delay for re-running the test.
                }
            } else {
                //console.log(new Date(),'info',"results: Processing 3");
                finalize(jobinfo);
            }
        } else {
            if (jobinfo.results.success != mylastresult && tryMe > 0) {
                jobinfo.retry = 1;
                console.log(new Date(),'info','results: Retesting again before declaring '+jobinfo._id+' '+upOrDown);
                recheck(jobinfo);
                //setTimeout((function(){checkthis(jobinfo);}), 30000); // 30 second delay for re-running the test.
            } else {
                //console.log(new Date(),'info',"results: Processing 4");
                finalize(jobinfo);
            }
        }
    }
    return true;
};

function finalize(jobinfo){
    //console.log('Finalize:',jobinfo);
    delete jobinfo.status;
    if(jobinfo.hasOwnProperty('retry')){
        delete jobinfo.retry;
    }
    //Make sure there's a start, end, and duration timestamps on this.
    if (!jobinfo.results) {
        console.log(new Date(),"error", "results: jobinfo missing results: "+sys.inspect(jobinfo));
        return false;
    }
    if (!jobinfo.results.start || jobinfo.results.start == 'undefined') {
        jobinfo.results.start = new Date().getTime();
        jobinfo.results.end = jobinfo.results.start;
        jobinfo.results.runtime =  0;
    }
    if (!jobinfo.results.end || jobinfo.results.end == 'undefined') {
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime =  jobinfo.results.start - jobinfo.results.end;
    }
    if (!jobinfo.results.runtime || jobinfo.results.runtime == 'undefined') {
        if (jobinfo.results.runtime !== 0) {
            jobinfo.results.runtime =  jobinfo.results.end - jobinfo.results.start;
        }
    }

    if (!jobinfo.location) {
        jobinfo.location = {};
    }
    jobinfo.location[jobinfo.results.start] = config.check_id;

    // Is this a 'down' result?
    if (!jobinfo.results.success && (!jobinfo.hasOwnProperty('state') || (jobinfo.state && jobinfo.state !== '0' && jobinfo.state !== 'false'))) {
        jobinfo.firstdown = jobinfo.results.start;
        console.log(new Date(),"info", 'results: setting firstdown: '+sys.inspect(jobinfo));
    }
    // Do we want to send this result to rhp?
    if (!jobinfo.dontsend || (jobinfo.dontsend && jobinfo.dontsend.toString() == 'false')) {
        postToResultsHandler(jobinfo);
    }
    // Is this a 'down' result?  Set the eventinfo
    if (jobinfo.state && jobinfo.state !== 'false' && jobinfo.results.success === false) {
        jobinfo.eventinfo = {code:'', message:'',start:jobinfo.results.start, type:'down'};
        if (jobinfo.results.statusCode) {
            jobinfo.eventinfo.code = jobinfo.results.statusCode;
        }
        if (jobinfo.results.message) {
            jobinfo.eventinfo.message = jobinfo.results.message;
        }
    } else if ((!jobinfo.state || jobinfo.state === 'false') && jobinfo.results.success === true && jobinfo.eventinfo && jobinfo.eventinfo.type && jobinfo.eventinfo.type === 'down') {
        // Up event, close the event
        jobinfo.eventinfo.end = jobinfo.results.start;
        jobinfo.firstdown = false;
    }
    // Reschedule this check.
    rescheduleCheck(jobinfo);
    return true;
}

function recheck(jobinfo){
    console.log('recheck:',jobinfo);
    if (!jobinfo.location) {
        jobinfo.location = {};
    }
    if (!jobinfo._id) {
        jobinfo._id = jobinfo.jobid;
    }
    if (jobinfo.results && jobinfo.results.start) {
        jobinfo.location[jobinfo.results.start] = config.check_id;
    }
    var checkpath = config.NodePingAgent_path+path.sep+'checks'+path.sep+os.platform()+path.sep+'check_'+jobinfo.type.toLowerCase();
    try {
        var check = require(checkpath);
        // Decode the params value.
        setTimeout(function(){
            check.check(jobinfo);
        },2000);
        return true;
    } catch(bonk) {
        console.log(new Date(),'Error: NodePingAgent: Check ',jobinfo,' error: ',bonk);
        var resultobj = require('./checks/results.js');
        var now = new Date().getTime();
        jobinfo.results = {start:now,end:now,runtime:0,success:false, statusCode:'error', message:'Invalid check type'};
        resultobj.process(jobinfo);
        return true;
    }
    return true;
}

function rescheduleCheck(jobinfo) {
    if (nputil.gettype(jobinfo.interval) != 'number') {
        jobinfo.interval = parseFloat(jobinfo.interval);
    }
    if (nputil.gettype(jobinfo.runat) != 'number') {
        jobinfo.runat = parseInt(jobinfo.runat);
    }
    jobinfo.runat = jobinfo.runat + (jobinfo.interval * 60000);
    var herenow = new Date().getTime();
    if (jobinfo.runat < herenow) {
        jobinfo.runat = herenow - 5000;
    }
    updateRunAt(jobinfo._id, jobinfo.runat);
    jobinfo.retry = 0;
    jobinfo.state = (jobinfo.results.success) ? 1 : 0;
    delete(jobinfo.results);
    jobinfo.location = {};
    if (!jobinfo.firstdown) {
        jobinfo.firstdown = 0;
    }
    if (!jobinfo.eventinfo) {
        jobinfo.eventinfo = {};
    }
    config.checklist[jobinfo._id] = jobinfo;
    return true;
}

function updateRunAt(jobid, runat) {
    console.log(new Date(),'Updating run at for',jobid, runat);
    if (config && config.checklist && config.checklist[jobid]) {
        config.checklist[jobid].runat =  runat;
        persistConfig();
    }
};

var persistConfig = function() {
    var prettyjsonconfig = JSON.stringify(config, null, 4);
    var configstring = 'var config = '+prettyjsonconfig+';\nfor(var i in config){\n    exports[i] = config[i];\n};';
    fs.unlinkSync(config.NodePingAgent_path+path.sep+'config.js');
    fs.writeFileSync(config.NodePingAgent_path+path.sep+'config.js', configstring, {encoding:'utf8',flag:'w'});
    return true;
};

function postToResultsHandler(jobinfo, rh) {
    //console.log(new Date(),'postToResultsHandler',jobinfo)
    // Send this to the results handler via an https post.
    if (!rh) {
        rh = config.heartbeathandler;
    }
    
    try {
        var postdata = querystring.stringify({results:JSON.stringify(jobinfo), agent:config.check_id, checktoken:config.check_token});
        var postoptions = {host:rh.host,
                           port:rh.port,
                           path:rh.path,
                           method:'POST',
                           agent:false,
                           headers:{'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': postdata.length},
                           rejectUnauthorized: false};
        //console.log(new Date(),"info", "PostOptions "+sys.inspect(postoptions));
        //console.log(new Date(),"info", "Post Data "+sys.inspect(postdata));
        var completed = false;
        var timeoutid = setTimeout(function() {
            if (!completed) {
                completed = true;   
                // add rh to blacklist
                retryPostToResultshandler(jobinfo);
            }
            if (req) {
                req.abort();
            }
            return true;
        }, 4500);

        var req = agent.request(postoptions,function(res) {
            var body = '';
            res.setEncoding('utf8');
            res.on('data', function(d) {
                //console.log(new Date(),'info',"Post to Resultshandler: data: "+sys.inspect(d));
                body += d;
            });
            res.on('end', function() {
                clearTimeout(timeoutid);
                completed = true;
                //var newnow = new Date().getTime();
                //console.log(new Date(),'info',"Post to Resultshandler: runtime: "+rh.name+':'+sys.inspect(newnow - now));
                if(body == '{"success":true}'){
                    console.log(new Date(),'info',"results: received success from "+rh.name+": "+sys.inspect(jobinfo._id));
                }else{
                    // Bummer, we failed somehow.
                    console.log(new Date(),'error',"results: Results handler "+rh.name+" error: "+sys.inspect(body));
                    if (body.indexOf('throttl') > -1 || body.indexOf('Check is not assigned') > -1) {
                        console.log(new Date(),'info',"Not retrying to submit results due to error type.");
                    } else {
                        retryPostToResultshandler(jobinfo);
                    }
                }
                return true;
            });
            return true;
        });
        req.write(postdata);
        req.setTimeout(4000); // 4 seconds to connect to rhp
        req.on("error", function(e) {
            clearTimeout(timeoutid);
            if (!completed) {
                completed = true;
                console.log(new Date(),'error',"rhpsubmit: Post to Resultshandler "+rh.name+": Error: "+sys.inspect(e));
                retryPostToResultshandler(jobinfo);
            }
            if (req) {
                req.abort();
                req = null;
            }
            return true;
        }).on("timeout", function() {
            clearTimeout(timeoutid);
            if (!completed) {
                completed = true;
                console.log(new Date(),'error',"rhpsubmit: Post to Resultshandler "+rh.name+": Timeout");
                retryPostToResultshandler(jobinfo);
            }
            if (req) {
                req.abort();
                req = null;
            }
            return true;
        });
        req.on("socket", function (socket) {
            socket.emit("agentRemove");
        });
        req.end();
        return true;
    } catch(connerror) {
        clearTimeout(timeoutid);
        console.log(new Date(),'error',"rhpsubmit: Post to Resultshandler "+rh.name+": Catch error: "+sys.inspect(connerror));
        if (!completed) {
            completed = true;
            console.log(new Date(),"error", "rhpsubmit is unable to post to results handler "+sys.inspect(rh)+" :"+sys.inspect(connerror));
            retryPostToResultshandler(jobinfo);
        }
        if (req) {
            req.abort();
            req = null;
        }
    }
    return true;
}

function retryPostToResultshandler(jobinfo) {
    if (jobinfo.hasOwnProperty('postretry')) {
        if (jobinfo.postretry > 8) {
            console.log(new Date(),'error',"rhpsubmit: unable to submit results final: "+sys.inspect(jobinfo));
            return true;
        } else {
            jobinfo.postretry = jobinfo.postretry +1;
            setTimeout((function(){postToResultsHandler(jobinfo);}), jobinfo.postretry*500);
            return true;
        }
    } else {
        jobinfo.postretry = 1;
        postToResultsHandler(jobinfo);
        return true;
    }
    return true;
}