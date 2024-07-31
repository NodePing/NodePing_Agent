/*
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*
 * NodePingAgent.js
 * configuration is at config.json
 * Install the NodePingAgent with 'install' argument such as 'node NodePingAgent.js install <your check id> <your check token>'
 * The install will attempt to create a crontab for the current user to run the AGENT at the configured interval
 * Manually run on command line such as 'node NodePingAgent.js'
 * Debug or test run with the 'test' argument such as 'node NodePingAgent.js test'
 * Disable the NodePingAgent with 'disable' argument such as 'node NodePingAgent.js disable'
 * Re-enable the NodePingAgent with 'enable' argument such as 'node NodePingAgent.js enable'
 * Uninstall the NodePingAgent with 'remove' argument such as 'node NodePingAgent.js remove'
 */

var util = require('util'),
    qs = require('querystring'),
    path = require('path'),
    fs = require('fs'),
    os = require('os'),
    querystring = require('querystring'),
    agent = require('https'),
    install = (process.argv[2] == 'install') ? true : false,
    test = (process.argv[2] == 'test') ? true : false,
    disable = (process.argv[2] == 'disable') ? true : false,
    enable = (process.argv[2] == 'enable') ? true : false,
    remove = (process.argv[2] == 'remove') ? true : false,
    checkoffset = 0,
    pluginsToRun = [],
    dataToReturn = {npcheckclock:{start:new Date().getTime()}},
    checksToRun = [];

process.on('uncaughtException', function (err) {
    console.log(new Date().toISOString(),'Error: NodePingAgent process error:',err);
    //process.exit(1);
});

process.on('SIGINT', function () {
    console.log(new Date().toISOString(),'NodePingAgent - SIGINT - Exiting.');
    process.kill(process.pid);
});

var config = {
    data: require('.'+path.sep+'config.json'),
    npconfig: require('.'+path.sep+'npconfig.json'),
    checkdata: {},
    writingConfig: false,
    writingNpconfig: false,
    writingCheckConfig: false,
    persistConfig: function(configData) {
        config.data = configData;
        if (config.writingConfig) {
            console.log('Already writing config file - giving up.');
            return true;
        }
        console.log('Persisting config to disk.');
        config.writingConfig = true;
        var prettyjsonconfig = JSON.stringify(config.data, null, 6);
        fs.open(config.data.agent_path+path.sep+'config.json', 'w+', function(error,fd){
            if (error) {
                console.log('config.json open error:',error);
                console.log('Unable to open config.json.  Please check file permissions.');
                if (fd) {
                    fs.close(fd, function(err){});
                }
                return false;
            }
            fs.write(fd, prettyjsonconfig, function(err, writtenbytes, unusedstring) {
                if (err) {
                    console.log('Config data write error:',err);
                } else {
                    console.log('Config data written');
                }
                fs.close(fd, function(err){});
                config.writingConfig = false;
            });
        });
        return true;
    },
    persistNpconfig: function(npconfig) {
        config.npconfig = npconfig;
        if (config.writingNpconfig) {
            console.log('Already writing npconfig file - giving up.');
            return true;
        }
        console.log('Persisting npconfig to disk.');
        config.writingNpconfig = true;
        var prettyjsonconfig = JSON.stringify(config.npconfig, null, 6);
        fs.open(config.data.agent_path+path.sep+'npconfig.json', 'w+', function(error,fd){
            if (error) {
                console.log('npconfig.json open error:',error);
                console.log('Unable to open npconfig.json.  Please check file permissions.');
                if (fd) {
                    fs.close(fd, function(err){});
                }
                return false;
            }
            fs.write(fd, prettyjsonconfig, function(err, writtenbytes, unusedstring) {
                if (err) {
                    console.log('Npconfig data write error:',err);
                } else {
                    console.log('Npconfig data written');
                }
                fs.close(fd, function(err){});
                config.writingNpconfig = false;
            });
        });
        return true;
    },
    setCheckData: function(checks) {
        if (checks) {
            config.checkdata = checks;
            return config.persistCheckData();
        }
        return false;
    },
    persistCheckData: function() {
        console.log('Persisting check data to disk');
        if (config.writingCheckConfig) {
            console.log('Already writing check data file - giving up.');
            return false;
        }
        config.writingCheckConfig = true;
        var prettyjsoncheckdata = JSON.stringify(config.checkdata, null, 6);
        //console.log('checkdata json:',prettyjsoncheckdata);
        fs.truncate(config.data.agent_path+path.sep+'checkdata.json', function(truncerror) {
            if (truncerror) {
                console.log('Checkdata file trucate error:',truncerror);
                console.log('Unable to truncate checkdata.json.  Please check file permissions.');
                return false;
            }
            fs.open(config.data.agent_path+path.sep+'checkdata.json', 'w+', function(error,fd) {
                if (error) {
                    console.log('Checkdata open error:',error);
                    console.log('Unable to write checkdata.json.  Please check file permissions.');
                    if (fd) {
                        fs.close(fd, function(err){});
                    }
                    return false;
                }
                fs.write(fd, prettyjsoncheckdata, function(err, writtenbytes, unusedstring) {
                    if (err) {
                        console.log('Check data write error:',err);
                    } else {
                        console.log('Check data written');
                    }
                    fs.close(fd, function(err){});
                    config.writingCheckConfig = false;
                    return true;
                });
                return true;
            });
            return true;
        });
        return true;
    }
};

// Load checkdata if there is any.
try {
    config.checkdata = JSON.parse(fs.readFileSync(config.data.agent_path+path.sep+'checkdata.json', 'utf8'));
} catch (e) {
    console.log('Error parsing checkdata',e);
}

var heartbeatoffset = config.data.heartbeatoffset || Math.floor((Math.random() * 20) + 1) * 1000;
config.data.heartbeatoffset = heartbeatoffset;

var getPluginData = function(data, callback) {
    if (pluginsToRun.length > 0) {
        var next = pluginsToRun.shift();
        try {
            console.log(new Date().toISOString(),'Info: NodePingAgent: Gathering data from',next,'plugin.');
            var plugin = require("./plugins/" + next);
            if (plugin) {
                return plugin.get(dataToReturn, getPluginData);
            } else {
                console.log(new Date().toISOString(),'Error: NodePingAgent: plugin',next,'missing.');
            }
        } catch(e) {
            console.log(new Date().toISOString(),'Error: NodePingAgent: plugin',next,'threw error:',e);
        }
        return getPluginData(dataToReturn, callback);
    } else {
        // We've got all the data.
        dataToReturn.npcheckclock.end = new Date().getTime();
        dataToReturn.checkcount = Object.keys(config.checkdata).length;
        return digestData();
    }
};

var digestData = function() {
    if (test) {
        console.log(new Date().toISOString(),'Info: NodePingAgent data:',dataToReturn);
        console.log(new Date().toISOString(),'Info: Not posting anything to NodePing.');
        return true;
    } else if (!config.data.check_enabled) {
        return false;
    }
    // Send data to NodePing
    console.log(new Date().toISOString(),'Info: NodePingAgent: Starting up: offset for heartbeat:',heartbeatoffset);
    setTimeout( function() {
        console.log(new Date().toISOString(),'Info: NodePingAgent: Sending heartbeat to NodePing:',dataToReturn);
        postHeartbeat(dataToReturn);
    }, heartbeatoffset);
    return true;
}

var postHeartbeat = function(data, retries) {
    if (!retries) {
        retries = 0;
    }
    var timeoutid = false;
    heartbeathandler = config.npconfig.heartbeathandler;
    data.npcheckclock.runtime = data.checkcount;
    try {
        dataToPost = {
            results:JSON.stringify(data), 
            updatestamp: config.data.agent_lastupdate,
            check:config.data.check_id, 
            checktoken:config.data.check_token
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
            timeoutid = setTimeout(function() {
                if (!completed) {
                    completed = true;
                    if (retries > 4) {
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
                    //console.log(new Date().toISOString(),'Info: NodePingAgent: received from NodePing:',body);
                    if (body.success) {
                        // Look for any config changes
                        if (body.config) updateConfig(body.config);
                        if (body.checklist) {
                            // Replace the checklist but retain the 'runat' and 'state' elements of existing checks so we can know when to run it next
                            var oldConfig = {};
                            for (var i in config.checkdata) {
                                oldConfig[config.checkdata[i]._id] = {"modified":config.checkdata[i].modified};
                                if (config.checkdata[i].runat) {
                                    oldConfig[config.checkdata[i]._id].runat = config.checkdata[i].runat;
                                }
                            }
                            // Replace the checklist with what we got from NodePing - so any check changes are reflected.
                            config.checkdata = {};
                            var now = new Date().getTime();
                            for (var i in body.checklist) {
                                config.checkdata[body.checklist[i]._id] = body.checklist[i];
                                if (oldConfig[body.checklist[i]._id]) {
                                    if (config.checkdata[body.checklist[i]._id].modified > oldConfig[body.checklist[i]._id].modified) {
                                        config.checkdata[body.checklist[i]._id].runat = now - 10;
                                    } else {
                                        config.checkdata[body.checklist[i]._id].runat = oldConfig[body.checklist[i]._id].runat;
                                    }
                                } else {
                                    config.checkdata[body.checklist[i]._id].runat = now - 10;
                                }
                                if (config.checkdata[body.checklist[i]._id].runat < now) {
                                    checksToRun.push(config.checkdata[body.checklist[i]._id]);
                                }
                            }
                            oldConfig = false;
                            body.checklist =  false;
                            // Save the new checklist
                            config.setCheckData(config.checkdata);
                            // Stagger the running of the checks evently over about 50 seconds minus the heartbeat offset
                            var checksToRunCount = checksToRun.length;
                            if (checksToRunCount) {
                                if (checksToRunCount > 500 || checksToRunCount < 5) {
                                    checkoffset = 0;
                                } else {
                                    checkoffset = Math.floor((50000-heartbeatoffset)/checksToRunCount);
                                }
                                //Sort the checks by runat so we don't get throttled
                                checksToRun.sort(function(a,b){
                                    if (a.runat && b.runat){
                                        return (a.runat - b.runat);
                                    } else {
                                        return 0;
                                    }
                                });
                            }
                            console.log(new Date().toISOString(),'Info: NodePingAgent: number of checks to run:',checksToRun.length, 'staggering checks',checkoffset,'ms');
                            processChecks();
                        }
                    } else {
                        // Bummer, we failed to submit the heartbeat..
                        if (body.config) {
                            updateConfig(body.config);
                        }
                        if (retries > 4) {
                            console.log(new Date().toISOString(),'Error: NodePingAgent: failed to post heartbeat to NodePing:',body);
                            return false;
                        } else {
                            if (body.error) {
                                console.log(new Date().toISOString(),'Error: NodePingAgent: Error posting heartbeat to NodePing:',body);
                                if (body.error.indexOf('hrottl') > -1) {
                                    console.log(new Date().toISOString(),'Info: NodePingAgent: Heartbeat is throttled');
                                    return false;
                                } else if (body.error.indexOf('No check found with that ID') > -1) {
                                    console.log(new Date().toISOString(),'Info: NodePingAgent: Check does not exist - disabling');
                                    updateConfig({check_enabled:false});
                                    return false;
                                }
                            }
                            retries++;
                            postHeartbeat(data, retries);
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
                    if (retries > 4) {
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
                    if (retries > 4) {
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
        if (timeoutid) clearTimeout(timeoutid);
        console.log(new Date().toISOString(),'Error: NodePingAgent error: Post to NodePing error: ',connerror);
        if (!completed) {
            completed = true;
            if (retries > 4) {
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
        var check = checksToRun.shift();
        //console.log('checkoffset',checkoffset);
        setTimeout( function() {
            runCheck(check);
        }, checkoffset);
    } else {
        console.log(new Date().toISOString(),'Info: NodePingAgent: finished starting all checks.');
    }
    return true;
};

var runCheck = function (checkinfo) {
    console.log(new Date().toISOString(),'Info: NodePingAgent: running check:',checkinfo._id, checkinfo.type,checkinfo.label);
    var checkpath = config.data.agent_path + path.sep + 'checks' + path.sep + os.platform() + path.sep + 'check_' + checkinfo.type.toLowerCase();
    try {
        fs.accessSync(checkpath+'.js', fs.constants.F_OK);
        console.log(new Date().toISOString(),'Info: NodePingAgent: Running check type:',checkinfo.type);
        try {
            var check = require(checkpath);
            check.check(checkinfo);
        } catch (bonk) {
            console.log(new Date().toISOString(),'Error: NodePingAgent: Check ',checkinfo,' error: ',bonk);
        }
    } catch (e) {
        console.log(new Date().toISOString(),'Error: NodePingAgent: No code available for check type:',checkinfo.type);
    }
    processChecks();
    return true;
}

var updateConfig = function(newconfig) {
    //console.log('Newconfig',newconfig);
    var updatedConfig =  false;
    var updatedNpConfig =  false;
    if (newconfig) {
        for (var c in newconfig) {
            if (c == 'check_interval'){
                if (config.data.check_interval != newconfig.check_interval) {
                    // New interval.  Reconfigure the cron job
                    setCronJob(newconfig.check_interval);
                    updatedConfig = true;
                }
                config.data[c] = newconfig[c];
            } else if (c == 'check_enabled') {
                config.data[c] = newconfig[c];
                updatedConfig = true;
            } else {
                // Other configs go in npconfig
                //console.log('Setting',c, 'to', newconfig[c]);
                config.npconfig[c] = newconfig[c];
                updatedNpConfig = true;
            }
        }
        if (updatedConfig) {
            config.persistConfig(config.data);
        }
        if (updatedNpConfig) {
            config.persistNpconfig(config.npconfig);
        }
    }
    return true;
};

var setCronJob = function(interval) {
    if (interval) {
        config.data.check_interval = interval;
    }
    // Delete current crontab if any.
    require('crontab').load(function(err,tab) {
        if (err) {
            console.log(new Date().toISOString(),'Error: NodePingAgent error on crontab load',err);
        }
        tab.remove(tab.findCommand("NodePingAgent.js"));
        // Add new crontab
        var agentTab = tab.create(config.data.node_path+' '+config.data.agent_path+path.sep+'NodePingAgent.js >> '+config.data.agent_logpath+' 2>&1');
        agentTab.minute().every(config.data.check_interval);
        tab.save(function(err,tab) {
            if (err) {
                console.log(new Date().toISOString(),'Error: NodePingAgent error on crontab save',err);
            } else {
                console.log(new Date().toISOString(),'Info: NodePingAgent crontab installed and enabled for every '+config.data.check_interval.toString()+' minutes.');
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
        config.data.check_id = checkid;
        config.data.check_token = checktoken;
        config.data.check_interval = interval;
    } else if (!checkid && (!config.data.check_id || config.data.check_id === '<Your NodePing Check ID>')) {
        console.log(new Date().toISOString(),'Error: NodePingAgent missing check id.');
        process.exit(1);
    } else if (!checktoken && (!config.data.check_token || config.data.check_token === '<Your NodePing Check Token>')) {
        console.log(new Date().toISOString(),'Error: NodePingAgent missing check token');
        process.exit(1);
    }
    config.data.check_enabled = true;
    config.data.node_path = process.argv[0];
    config.data.agent_path = __dirname;
    config.data.agent_logpath = __dirname+path.sep+'log'+path.sep+'NodePingAgent.log';
    config.data.heartbeatoffset = Math.floor((Math.random() * 20) + 1) * 1000;
    // Set cron job
    setCronJob();
    // save config
    config.persistConfig(config.data);
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
                rmdir(config.data.agent_path, function(err) {
                    if (err) {
                        console.log(new Date().toISOString(),'Error: NodePingAgent unable to delete files in',config.data.agent_path);
                    } else {
                        console.log(new Date().toISOString(),'Info: NodePingAgent files removed');
                    }
                    process.exit(0);
                });
            } else {
                config.data.check_enabled = false;
                config.persistConfig(config.data);
                setTimeout(function() {
                    console.log(new Date().toISOString(),'Info: NodePingAgent disabled');
                    process.exit(0);
                }, 1000);
            }
        });
        return true;
    });
    return true;
};

if (!config.data.check_enabled) {
    console.log(new Date().toISOString(),'Info: NodePingAgent is currenly disabled in config.json');
}
for (var p in config.data.plugins) {
    if (config.data.plugins[p].enabled) {
        pluginsToRun.push(p);
    }
}

if (install || enable) {
    installOrEnable();
} else if (disable || remove ) {
    disableOrRemove();
} else {
    if (config.data.check_id === '<Your NodePing Check ID>' || config.data.check_token === '<Your NodePing Check Token>') {
        console.log(new Date().toISOString(),'Error: NodePingAgent: Please add your check id and check token to config.json');
        process.exit(1);
    }
    getPluginData(dataToReturn, getPluginData);
}