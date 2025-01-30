/*
 * NodePing
 * Copyright(c) 2025 NodePing LLC
 */

/*!
 * persist.js
 * Handles reading and writing to the checkdata.json file
 */

var sys = require("util"),
    path = require('path'),
    fs = require('fs'),
    os = require('os'),
    nputil = require('.'+path.sep+'nputil');

var config = {
    data: require('.'+path.sep+'config.json'),
    checkdata: {},
    writingCheckConfig: false,
    checksToRun:0,
    checksComplete:0,
    persistTimer: false
}

exports.getCheckdata = function() {
    return readCheckdata();
};

exports.addCheckdata = function(jobinfo) {
    if (!jobinfo._id) return false;
    config.checkdata[jobinfo._id] = jobinfo;
    config.checksComplete++;
    if (config.checksToRun <= config.checksComplete && !config.writingCheckConfig) {
        saveCheckdata();
        if (config.persistTimer) {
            clearTimeout(config.persistTimer);
        }
    }
    return true;
};

exports.setCheckdata = function(checkdata) {
    config.checkdata = checkdata;
    saveCheckdata();
    if (!config.persistTimer) {
        var d = new Date();
        var seconds = d.getSeconds();
        var delay = 58 - seconds;
        if (delay) {
            console.log(new Date(),"info",'Setting persistTimer',delay);
            config.persistTimer = setTimeout(function() {
                console.log(new Date(),"info",'Saving Checkdata - persistTimer');
                saveCheckdata();
            },delay*1000);
        }
    }
    return true;
};

var readCheckdata = function() {
    try {
        config.checkdata = JSON.parse(fs.readFileSync(config.data.agent_path+path.sep+'checkdata.json', 'utf8'));
    } catch (e) {
        console.log('Error parsing checkdata.json',e);
        config.checkdata = {};
    }
    return config.checkdata;
};

var saveCheckdata = function(retry) {
    retry = retry || 0;
    //console.log('Persisting check data to disk - retry = '+retry.toString());
    if (config.writingCheckConfig) {
        if (retry > 5) {
            console.log(new Date(),"error",'Results: Already writing check data file - We retried 5 times. Giving up.');
            return true;
        } else {
            retry++;
            //console.log('Already writing check data file - retrying in 1.5 seconds. Retry = '+retry.toString());
            return setTimeout(function(){
                return config.persistCheckData(retry);
            },1500*retry);
        }
    } 
    config.writingCheckConfig = true;
    var prettyjsoncheckdata = JSON.stringify(config.checkdata, null, 6);
    //console.log('checkdata json:',prettyjsoncheckdata);
    fs.truncate(config.data.agent_path+path.sep+'checkdata.json', function(truncerror) {
        if (truncerror) {
            console.log(new Date(),"error",'Results: Checkdata file trucate error:',truncerror);
            console.log('Results: Unable to truncate checkdata.json.  Please check file permissions.');
            config.writingCheckConfig = false;
            return false;
        }
        fs.open(config.data.agent_path+path.sep+'checkdata.json', 'w+', function(error,fd) {
            if (error) {
                console.log(new Date(),"error",'Results: Checkdata open error:',error);
                console.log('Results: Unable to write checkdata.json.  Please check file permissions.');
                if (fd) {
                    fs.close(fd, function(err){});
                }
                config.writingCheckConfig = false;
                return false;
            }
            fs.write(fd, prettyjsoncheckdata, function(err, writtenbytes, unusedstring) {
                if (err) {
                    console.log(new Date(),"error",'Results: Check data write error:',err);
                } else {
                    console.log(new Date(),"info",'Check data written');
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
};

exports.setNumChecksToRun = function(num) {
    config.checksToRun = parseInt(num);
    return true;
};