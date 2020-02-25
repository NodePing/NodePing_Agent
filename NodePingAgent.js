/*
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*
 * NodePingAgent.js
 * configuration is at ./config.js
 * Install the NodePingAgent with 'install' argument such as './NodePingAgent.js install <your check id> <your check token>'
 * To be run on command line such as './NodePingAgent.js'
 * Debug or test run with the 'test' argument such as './NodePingAgent.js test'
 * Disable the NodePingAgent with 'disable' argument such as './NodePingAgent.js disable'
 * Re-enable the NodePingAgent with 'enable' argument such as './NodePingAgent.js enable'
 * Uninstall the NodePingAgent with 'remove' argument such as './NodePingAgent.js remove'
 */

var util = require('util'),
    fs = require('fs'),
    qs = require('querystring'),
    path = require('path'),
    os = require('os'),
    querystring = require('querystring'),
    agent = require('https'),
    install = (process.argv[2] == 'install') ? true : false,
    test = (process.argv[2] == 'test') ? true : false,
    disable = (process.argv[2] == 'disable') ? true : false,
    enable = (process.argv[2] == 'enable') ? true : false,
    remove = (process.argv[2] == 'remove') ? true : false,
    config = require('./config'),
    checkoffset = 0,
    heartbeatoffset = config.heartbeatoffset || Math.floor((Math.random() * 30) + 1) * 1000,
    pluginsToRun = [],
    dataToReturn = {npcheckclock:{start:new Date().getTime()}},
    checksToRun = [];

process.on('uncaughtException', function (err) {
    console.log(new Date().toISOString(),'Error: NodePingAgent process error: '+err.message);
    process.exit(1);
});

process.on('SIGINT', function () {
    console.log(new Date().toISOString(),'NodePingAgent - SIGINT - Exiting.');
    process.kill(process.pid);
});

var persistConfig = function() {
    var prettyjsonconfig = JSON.stringify(config, null, 4);
    var configstring = 'var config = '+prettyjsonconfig+';\nfor(var i in config){\n    exports[i] = config[i];\n};';
    fs.unlinkSync(config.NodePingAgent_path+path.sep+'config.js');
    fs.writeFileSync(config.NodePingAgent_path+path.sep+'config.js', configstring, {encoding:'utf8',flag:'w'});
    return true;
};

var getPluginData = function(data, callback) {
    if (pluginsToRun.length > 0) {
        var next = pluginsToRun.pop();
        try {
            console.log(new Date().toISOString(),'Info: NodePingAgent: Gathering data from',next,'plugin.');
            var plugin = require("./plugins/" + next);
            if (plugin) {
                return plugin.get(data, getPluginData);
            } else {
                console.log(new Date().toISOString(),'Error: NodePingAgent: plugin',next,'missing.');
            }
        } catch(e) {
            console.log(new Date().toISOString(),'Error: NodePingAgent: plugin',next,'threw error:',e);
        }
        return getPluginData(data, callback);
    } else {
        // We've got all the data.
        data.npcheckclock.end = new Date().getTime();
        data.checkcount = Object.keys(config.checklist).length;
        return digestData(data);
    }
};

var digestData = function(data) {
    if (test) {
        console.log(new Date().toISOString(),'Info: NodePingAgent data:',data);
        console.log(new Date().toISOString(),'Info: Not posting anything to NodePing.');
        return true;
    } else if (!config.NodePingAgent_enabled) {
        return false;
    }
    // Send data to NodePing
    console.log(new Date().toISOString(),'Info: NodePingAgent: offset for heartbeat:',heartbeatoffset);
    setTimeout( function() {
        console.log(new Date().toISOString(),'Info: NodePingAgent: Sending heartbeat to NodePing:',data);
        postHeartbeat(data);
    }, heartbeatoffset);
    return true;
}

var postHeartbeat = function(data, retries) {
    if (!retries) {
        retries = 0;
    }
    heartbeathandler = config.heartbeathandler;
    data.npcheckclock.runtime = data.checkcount;
    try {
        dataToPost = {
            results:JSON.stringify(data), 
            updatestamp: config.NodePingAgent_lastupdate,
            check:config.check_id, 
            checktoken:config.check_token
        };
        var querystring = require('querystring');
        var agent = require('https');
        var postdata = querystring.stringify(dataToPost);
        var postoptions = {host:heartbeathandler.host,
                           port:heartbeathandler.port,
                           path:heartbeathandler.path,
                           method:'POST',
                           agent:false,
                           rejectUnauthorized: false,
                           headers:{'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': postdata.length}};
        var completed = false;
        setTimeout(function(){
            var timeoutid = setTimeout(function() {
                if (!completed) {
                    completed = true;
                    if (retries > 10) {
                        console.log(new Date().toISOString(),'Error: NodePingAgent: failed to post data to NodePing');
                    } else {
                        retries++;
                        postHeartbeat(data, retries);
                    }
                }
                if (req) {
                    req.abort();
                }
                console.log(new Date().toISOString(),'Error: NodePingAgent: timer timeout:',retries);
                return true;
            }, 9000);

            var req = agent.request(postoptions,function(res) {
                var body = '';
                res.setEncoding('utf8');
                res.on('data', function(d) {
                    body += d;
                });
                res.on('end', function() {
                    clearTimeout(timeoutid);
                    completed = true;
                    body = JSON.parse(body);
                    console.log(new Date().toISOString(),'Info: NodePingAgent: received from NodePing:',body);
                    if (body.success) {
                        // Look for any config changes
                        if (body.config) updateConfig(body.config);
                        if (body.checklist) {
                            // Replace the checklist but retain the 'runat' and 'state' elements of existing checks so we can know when to run it next
                            var oldConfig = {};
                            for (var i in config.checklist) {
                                oldConfig[config.checklist[i]._id] = {"modified":config.checklist[i].modified};
                                if (config.checklist[i].runat) {
                                    oldConfig[config.checklist[i]._id].runat = config.checklist[i].runat;
                                }
                            }
                            // Replace the checklist with what we got from NodePing - so any check changes are reflected.
                            config.checklist = {};
                            var now = new Date().getTime();
                            for (var i in body.checklist) {
                                config.checklist[body.checklist[i]._id] = body.checklist[i];
                                if (oldConfig[body.checklist[i]._id]) {
                                    if (config.checklist[body.checklist[i]._id].modified > oldConfig[body.checklist[i]._id].modified) {
                                        config.checklist[body.checklist[i]._id].runat = now - 10;
                                    } else {
                                        config.checklist[body.checklist[i]._id].runat = oldConfig[body.checklist[i]._id].runat;
                                    }
                                } else {
                                    config.checklist[body.checklist[i]._id].runat = now - 10;
                                }
                                if (config.checklist[body.checklist[i]._id].runat < now) {
                                    checksToRun.push(config.checklist[body.checklist[i]._id]);
                                }
                            }
                            oldConfig = false;
                            body.checklist =  false;
                            // Save the new checklist
                            updateConfig(config);
                            // Stagger the running of the checks evently over about 50 seconds minus the heartbeat offset
                            var checksToRunCount = checksToRun.length;
                            if (checksToRunCount) {
                                if (checksToRunCount > 100 || checksToRunCount < 5) {
                                    checkoffset = 0;
                                } else {
                                    checkoffset = Math.floor((50000-heartbeatoffset)/checksToRunCount);
                                }
                            }
                            processChecks();
                        }
                    } else {
                        // Bummer, we failed to submit the heartbeat..
                        if (body.config) {
                            updateConfig(body.config);
                        }
                        if (retries > 10) {
                            console.log(new Date().toISOString(),'Error: NodePingAgent: failed to post heartbeat to NodePing:',body);
                            return false;
                        } else {
                            retries++;
                            postHeartbeat(data, retries);
                        }
                        if (body.error) {
                            console.log(new Date().toISOString(),'Error: NodePingAgent: Error posting heartbeat to NodePing:',body);
                            if (body.error.indexOf('throttling') > -1) {
                                retries++
                                postHeartbeat(data, retries);
                            }
                            return false;
                        }
                        
                    }
                    return true;
                });
                return true;
            });
            req.write(postdata);
            req.setTimeout(8500); // 8 seconds to connect to NodePing
            req.on("error", function(e) {
                clearTimeout(timeoutid);
                if (!completed) {
                    completed = true;
                    if (retries > 10) {
                        console.log(new Date().toISOString(),'Error: NodePingAgent: failed to post data to NodePing: error:',e);
                    } else {
                        retries++;
                        postHeartbeat(data, retries);
                    }
                }
                if (req) {
                    req.abort();
                    req = null;
                }
                console.log(new Date().toISOString(),'Error: NodePingAgent: Error event from NodePing:',e);
                return true;
            }).on("timeout", function() {
                clearTimeout(timeoutid);
                if (!completed) {
                    completed = true;
                    if (retries > 10) {
                        console.log(new Date().toISOString(),'Error: NodePingAgent: failed to post data to NodePing: timeout');
                    } else {
                        retries++;
                        postHeartbeat(data, retries);
                    }
                }
                if (req) {
                    req.abort();
                    req = null;
                }
                console.log(new Date().toISOString(),'Error: NodePingAgent: Timeout event on NodePing');
                return true;
            });
            req.on("socket", function (socket) {
                socket.emit("agentRemove");
            });
            req.end();
        }, retries*200);
        
    } catch (connerror) {
        clearTimeout(timeoutid);
        console.log(new Date().toISOString(),'Error: NodePingAgent error: Post to NodePing error: ',connerror);
        if (!completed) {
            completed = true;
            if (retries > 10) {
                console.log(new Date().toISOString(),'Error: NodePingAgent: failed to post data to NodePing');
            } else {
                retries++;
                postHeartbeat(data, retries);
            }
        }
        if (req) {
            req.abort();
            req = null;
        }
        console.log(new Date().toISOString(),'Error: NodePingAgent: Error caught on NodePing:',connerror);
    }
    return true;
}

var processChecks = function() {
    if (checksToRun.length) {
        var check = checksToRun.pop();
        console.log('checkoffset',checkoffset);
        setTimeout( function() {
            runCheck(check);
        }, checkoffset);
    } else {
        console.log(new Date().toISOString(),'Info: NodePingAgent: finished running all checks.');
    }
    return true;
};

var runCheck = function (checkinfo) {
    console.log(new Date().toISOString(),'Info: NodePingAgent: running check:',checkinfo);
    var checkpath = config.NodePingAgent_path + path.sep + 'checks' + path.sep + os.platform() + path.sep + 'check_' + checkinfo.type.toLowerCase();
    fs.access(checkpath+'.js', fs.constants.F_OK, function(err) {
        if (err) {
            console.log(new Date().toISOString(),'Error: NodePingAgent: No code available for check type:',checkinfo.type);
        } else {
            console.log(new Date().toISOString(),'Info: NodePingAgent: Running check type:',checkinfo.type);
            try {
                var check = require(checkpath);
                // Decode the params value.
                check.check(checkinfo);
            } catch (bonk) {
                console.log(new Date().toISOString(),'Error: NodePingAgent: Check ',checkinfo,' error: ',bonk);
                var resultobj = require('./checks/results.js');
                var now = new Date().getTime();
                checkinfo.results = {start:now,end:now,runtime:0,success:false, statusCode:'error', message:'Invalid check type'};
                resultobj.process(checkinfo);
            }
        }
        processChecks();
    });
    return true;
}

var updateConfig = function(newconfig) {
    //console.log('Newconfig',newconfig);
    if (newconfig) {
        for (var c in newconfig) {
            if (c == 'check_interval' && config.check_interval != newconfig.check_interval) {
                // New interval.  Reconfigure the cron job
                setCronJob(newconfig.check_interval);
            }
            //console.log('Setting',c, 'to', newconfig[c]);
            config[c] = newconfig[c];
        }
        persistConfig();
    }
    return true;
};

var setCronJob = function(interval) {
    if (interval) {
        config.check_interval = interval;
    }
    // Delete current crontab if any.
    require('crontab').load(function(err,tab) {
        if (err) {
            console.log(new Date().toISOString(),'Error: NodePingAgent error on crontab load',err);
        }
        tab.remove(tab.findCommand("NodePingAgent.js"));
        // Add new crontab
        var agentTab = tab.create(config.nodepath+' '+config.NodePingAgent_path+path.sep+'NodePingAgent.js >> '+config.NodePingAgent_logpath+' 2>&1');
        agentTab.minute().every(config.check_interval);
        tab.save(function(err,tab) {
            if (err) {
                console.log(new Date().toISOString(),'Error: NodePingAgent error on crontab save',err);
            } else {
                console.log(new Date().toISOString(),'Info: NodePingAgent crontab installed and enabled for every '+config.check_interval.toString()+' minutes.');
            }
            return true;
        });
        return true;
    });
    return true;
}

var installOrEnable = function() {
    if (install) {
        console.log(new Date().toISOString(),'Info :NodePingAgent installing NodePingAgent');
    } else {
        console.log(new Date().toISOString(),'Info: NodePingAgent enabling NodePingAgent');
    }

    // Let's look at the arguments passed to see if we have a check id and check token to do the install.
    var interval = 1;
    var checkid, checktoken;
    var identifyArg = function(arg) {
        if (arg && arg.length) {
            if (arg.length === 36) {
                // This is a check token
                checktoken = arg;
            } else if (arg.length < 10) {
                // This must be an interval
                interval = parseInt(arg);
            } else if (arg.indexOf('-')) {
                // This is a check id
                checkid =  arg;
            } else {
                console.log(new Date().toISOString(),'Error: unrecognized argument:',arg);
            }
        }
    };
    if (process.argv[3]) identifyArg(process.argv[3]);
    if (process.argv[4]) identifyArg(process.argv[4]);
    if (process.argv[5]) identifyArg(process.argv[5]);

    if (interval && checkid && checktoken) {
        console.log(new Date().toISOString(),'Info: NodePingAgent setting checkid = '+checkid+', token = '+checktoken+', and interval = '+interval);
        config.check_id = checkid;
        config.check_token = checktoken;
        config.check_interval = interval;
    } else if (!checkid && (!config.check_id || config.check_id === '<Your NodePing Check ID>')) {
        console.log(new Date().toISOString(),'Error: NodePingAgent missing check id.');
        process.exit(1);
    } else if (!checktoken && (!config.check_token || config.check_token === '<Your NodePing Check Token>')) {
        console.log(new Date().toISOString(),'Error: NodePingAgent missing check token');
        process.exit(1);
    }
    config.NodePingAgent_enabled = true;
    config.nodepath = process.argv[0];
    config.NodePingAgent_path = __dirname;
    config.NodePingAgent_logpath = __dirname+path.sep+'log'+path.sep+'NodePingAgent.log';
    config.heartbeatoffset = Math.floor((Math.random() * 30) + 1);
    // Set cron job
    setCronJob();
    // save config
    persistConfig();
};

var disableOrRemove = function() {
    if (disable) {
        console.log(new Date().toISOString(),'Info: NodePingAgent disabling NodePingAgent');
    } else {
        console.log(new Date().toISOString(),'Info: NodePingAgent removing NodePingAgent');
    }
    
    // Remove the crontab
    require('crontab').load(function(err,tab) {
        if (err) {
            console.log(new Date().toISOString(),'Error: NodePingAgent error on crontab load',err);
        }
        tab.remove(tab.findCommand("NodePingAgent.js"));
        tab.save(function(err,tab) {
            if (err) {
                console.log(new Date().toISOString(),'Error: NodePingAgent error on crontab save',err);
            }
            console.log(new Date().toISOString(),'Info: NodePingAgent crontab removed');
            if (remove) {
                // Delete NodePingAgent files
                var rmdir = require('rimraf');
                rmdir(config.NodePingAgent_path, function(err) {
                    if (err) {
                        console.log(new Date().toISOString(),'Error: NodePingAgent unable to delete files in',config.NodePingAgent_path);
                    } else {
                        console.log(new Date().toISOString(),'Info: NodePingAgent files removed');
                    }
                    process.exit(0);
                });
            } else {
                config.NodePingAgent_enabled = false;
                persistConfig();
                console.log(new Date().toISOString(),'Info: NodePingAgent disabled');
                process.exit(0);
            }
        });
        return true;
    });
    return true;
};

if (!config.NodePingAgent_enabled) {
    console.log(new Date().toISOString(),'Info: NodePingAgent is currenly disabled in ./config.js');
}
for (var p in config.plugins) {
    if (config.plugins[p].enabled) {
        pluginsToRun.push(p);
    }
}

if (install || enable) {
    installOrEnable();
} else if (disable || remove ) {
    disableOrRemove();
} else {
    if (config.check_id === '<Your NodePing Check ID>' || config.check_token === '<Your NodePing Check Token>') {
        console.log(new Date().toISOString(),'Error: NodePingAgent: Please add your check id and check token to config.js');
        process.exit(1);
    }
    getPluginData(dataToReturn, getPluginData);
}