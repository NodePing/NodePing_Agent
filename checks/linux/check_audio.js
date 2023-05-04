/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_audio.js
 * http audio stream.  Looks at the header for audio in the content type.
 * optionally checks for dead air (low volume)
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:10000              // Can be overriden by a parameter
};

var resultobj = require('../results.js');
var url = require('url');
var sys = require('util');
var logger = console;
var icy = require('icy');

exports.check = check = function(jobinfo){
    var defaulttimeout = config.timeout * 1;
    var timeout = config.timeout * 1;
    if(jobinfo.parameters.threshold){
        defaulttimeout = 1000 * parseInt(jobinfo.parameters.threshold);
        if (defaulttimeout > 90000) defaulttimeout = 90000;
        timeout = defaulttimeout + 2000;
    }
    //logger.log('info',"check_audio: Jobinfo passed to http stream check: "+sys.inspect(jobinfo));
    if (jobinfo.debug) config.debug = jobinfo.debug;
    jobinfo.results = {start:new Date().getTime()};
    if (!jobinfo.parameters.target) {
        logger.log('info',"check_audio: Invalid URL");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid URL';
        resultobj.process(jobinfo, true);
        return true;
    } else {
        if (!jobinfo.originaltarget) {
            jobinfo.originaltarget = jobinfo.parameters.target;
        }
        try {
            var thetarget = jobinfo.redirecttarget || jobinfo.parameters.target;
            var targetinfo = url.parse(thetarget);
            targetinfo.headers = { 'user-agent': 'NodePing' };
            targetinfo.rejectUnauthorized = false;
        } catch (error) {
            logger.log('info',"check_audio: Invalid URL");
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'URL will not parse: '+error;
            resultobj.process(jobinfo, true);
            return true;
        }

        //logger.log('info','check_audio: Targetinfo is: '+sys.inspect(targetinfo));
        //logger.log('info',"check_audio: Url for job "+jobinfo._id+" is "+jobinfo.parameters.target);
        if (targetinfo.pathname.substr(-4).toLowerCase() === 'm3u8' || targetinfo.pathname.substr(-3).toLowerCase() === 'm3u') {
            //logger.log('info','check_audio: Found a m3u playlist: '+sys.inspect(targetinfo.pathname));
            return processPlaylist(targetinfo,jobinfo);
        } else if (targetinfo.pathname.substr(-3).toLowerCase() === 'pls') {
            //logger.log('info','check_audio: Found a pls playlist: '+sys.inspect(targetinfo.pathname));
            return processPlaylist(targetinfo,jobinfo,'pls');
        } else if (targetinfo.pathname.substr(-4).toLowerCase() === 'xspf') {
            //logger.log('info','check_audio: Found a xspf playlist: '+sys.inspect(targetinfo.pathname));
            return processPlaylist(targetinfo,jobinfo,'xspf');
        }

        var killit = false;
        var timeoutid = setTimeout(function() {
            if (killit) {
                return true;
            }
            killit = true;
            if (stream) {
                stream.abort();
            }
            //logger.log('info',"check_audio: setTimeout called: "+timeout.toString());
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Timeout';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Timeout';
            resultobj.process(jobinfo);
            return true;
        }, timeout);
        try {
            var stream = icy.get(targetinfo, function (res) {
                res.on('data', function (data) {
                    if(stream){
                        stream.abort();
                    }
                //    var parsed = icecast.parse(metadata);
                //    logger.log("info","Radio Stream metadata: "+sys.info(parsed));
                });
            });
            //stream.on('connect', function() {
                //logger.log("info","Radio Stream connected at "+jobinfo.parameters.target);
            //});

            stream.setTimeout(timeout-500, function() {
                if(killit){
                    return true;
                }
                killit = true;
                if(stream){
                    stream.abort();
                }
                //logger.log('info',"check_audio: setTimeout called: "+timeout.toString());
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout';
                resultobj.process(jobinfo);
                return true;
            });
            stream.on('response', function(res) {
                //logger.log("info","Radio Stream response at "+jobinfo.parameters.target);
                //logger.log("info",sys.inspect(res.headers));
                jobinfo.results.end = new Date().getTime();
                killit = true;
                clearTimeout(timeoutid);
                var remoteAddress = stream.connection.remoteAddress;
                //logger.log('info',sys.inspect(remoteAddress));
                stream.abort();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = res.statusCode;
                if (res.statusCode >=300 && res.statusCode < 399) {
                    // Have we redirected too many times already?
                    if (jobinfo.redirectcount && jobinfo.redirectcount > 4) {
                        // Too many redirects.
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'Too many redirects';
                        jobinfo.results.statusCode = res.statusCode;
                        resultobj.process(jobinfo);
                        return true;
                    } else {
                        if (!jobinfo.redirectcount) {
                            jobinfo.redirectcount = 1;
                        } else {
                            jobinfo.redirectcount = jobinfo.redirectcount + 1;
                        }
                        // Set the new redirecttarget and try again.
                        logger.log('info',"check_audio: redirect header says "+sys.inspect(res.headers.location));
                        var redirect = res.headers.location;
                        if (redirect.indexOf('https:') === 0 || redirect.indexOf('http:') === 0 || redirect.indexOf('HTTP:') === 0 || redirect.indexOf('HTTPS:') === 0) {
                            // Absolute redirect.
                        } else {
                            // relative redirect - need to get the right base url (either parameters.target or a previous redirect target)
                            thetarget = jobinfo.redirecttarget || jobinfo.parameters.target;
                            targetinfo = url.parse(thetarget);
                            if (redirect.indexOf('/') === 0) {
                                // Replace the whole pathname
                                var toreplace = targetinfo.pathname;
                                if (targetinfo.search) {
                                    toreplace = toreplace + targetinfo.search;
                                }
                                logger.log('info',"check_audio: Going to replace: "+sys.inspect(toreplace)+" with "+sys.inspect(redirect));
                                var pos = targetinfo.href.lastIndexOf(toreplace);
                                if (pos > 7) {
                                    redirect = targetinfo.href.substring(0, pos) + redirect;
                                } else {
                                    logger.log('error',"check_audio: Weird placement for the last instance of: "+sys.inspect(toreplace)+" in "+sys.inspect(redirect)+' for check '+jobinfo.jobid);
                                }
                            } else {
                                // tack this redirect on the end of the current path - removing the search, if any.
                                if (targetinfo.pathname.slice(-1) !== '/') {
                                    // strip off the last filename if any.
                                    var pos = targetinfo.href.lastIndexOf('/');
                                    if (pos > 7) {
                                        targetinfo.href = targetinfo.href.substring(0, pos);
                                    }
                                    redirect = '/'+redirect;
                                }
                                if (targetinfo.search) {
                                    targetinfo.href = targetinfo.href.replace(targetinfo.search,'');
                                }
                                redirect = targetinfo.href+redirect;
                            }
                        }
                        jobinfo.redirecttarget = redirect;
                        jobinfo.redirectstart = jobinfo.results.start; 
                        stream.abort();
                        return check(jobinfo);
                    }
                } else if (res.statusCode >=200 && res.statusCode < 399) {
                    // Did it take too long?
                    if (defaulttimeout < jobinfo.results.runtime) {
                        //logger.log('info','check_audio: Timeout: '+sys.inspect(defaulttimeout)+" is less than "+sys.inspect(jobinfo.results.runtime));
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'Responded but slower than configured threshold';
                        jobinfo.results.statusCode = 'Timeout';

                    } else {
                        if (res.headers && res.headers["content-type"]) {
                            if (res.headers["content-type"].toLowerCase().indexOf("audio") > -1 || res.headers["content-type"].toLowerCase() === 'video/mp2t') {
                                jobinfo.results.success = true;
                                jobinfo.results.message = 'Success';
                                if (jobinfo.parameters.verifyvolume) {
                                    // Dead air check
                                    return checkForDeadAir(jobinfo);
                                }
                            } else {
                                jobinfo.results.success = false;
                                jobinfo.results.message = 'Invalid audio stream';
                                
                                jobinfo.results.diag = {"http":{
                                    responseheaders:res.headers,
                                    httpstatus:res.statusCode,
                                    httpserverip:remoteAddress}
                                };
                            }
                        } else {
                            jobinfo.results.success = false;
                            jobinfo.results.message = 'missing content-type header';
                        }
                    }
                } else {
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Bad HTTP response';
                    jobinfo.results.diag = {"http":{
                        responseheaders:res.headers,
                        httpstatus:res.statusCode,
                        httpserverip:remoteAddress}
                    };
                }
                if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
                resultobj.process(jobinfo);
                return true;
            });
            stream.on('error', function(error) {
                if (stream) {
                    stream.abort();
                }
                logger.log("info","Audio Stream error from "+jobinfo.parameters.target+" : "+sys.inspect(error));
                clearTimeout(timeoutid);
                if (!killit) {
                    killit = true;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.success = false;
                    jobinfo.results.message = error.toString();
                    if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
                    resultobj.process(jobinfo);
                }
                return true;
            });
            return true;
        } catch(ec) {
            clearTimeout(timeoutid);
            if (!killit) {
                if (stream) stream.abort();
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = "Caught "+ec.toString();
                if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
                resultobj.process(jobinfo);
                killit = true;
            }
            return true;
        }
    }
    return true;
};

var checkForDeadAir = function(jobinfo){
    //logger.log("info","Audio Stream checking for dead air: "+jobinfo._id);
    var ffmpeg = require('fluent-ffmpeg');
    var volumemin = jobinfo.parameters.volumemin || -45;
    new ffmpeg({ source: jobinfo.parameters.target })
        .withAudioFilter('volumedetect')
        .addOption('-f', 'null')
        .addOption('-t', '10') // listen to 10 seconds of audio
        .addOption('-timeout', '15')
        .noVideo()
        .on('start', function(ffmpegCommand){
            //logger.log("info",'Audio Stream: Output the ffmpeg command', ffmpegCommand);
        })
        .on('end', function(stdout, stderr){
            // find the mean_volume in the output
            var meanVolumeRegex = stderr.match(/mean_volume:\s(-?\d*(\.\d+)?)/);
           
            // return the mean volume
            if(meanVolumeRegex){
                var meanVolume = parseFloat(meanVolumeRegex[1]);
                jobinfo.results.message = "Volume detected: "+meanVolume.toString();
                if ( meanVolume >= volumemin ) {
                    // Volume is good
                    jobinfo.results.statusCode = jobinfo.results.message;
                    //logger.log("info",'Audio Stream: meanVolume is good: '+sys.inspect(meanVolume));
                } else {
                    //logger.log("info",'Audio Stream: meanVolume failure: '+sys.inspect(meanVolume));
                    jobinfo.results.statusCode = 'Volume Failure';
                    jobinfo.results.success = false;
                    if (!jobinfo.results.diag) {
                        jobinfo.results.diag = {"audio":{volume:meanVolume}};
                    } else {
                        jobinfo.results.diag.audio = {volume:meanVolume};
                    }
                }
            } else {
                logger.log("error",'Audio Stream: meanVolume not found: '+sys.inspect(stderr));
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Unable to get detect volume level - please contact support.';
            }
            if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
            resultobj.process(jobinfo);
        })
        .on('error', function(err) {
            //logger.log("error",'Audio Stream: volume check "error" event: '+sys.inspect(err));
            jobinfo.results.statusCode = 'Error';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Unable to get detect volume level - Not a valid audio stream';
            if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
            resultobj.process(jobinfo);
        })
        .saveToFile('/dev/null'); // cause we don't care about this data
};

var processPlaylist = function(targetinfo, jobinfo, playlisttype) {
    // Get the playlist and find a URL to check.
    //logger.log('info',"check_audio: processPlaylist targetinfo: "+sys.inspect(targetinfo));
    var agent;
    jobinfo.results = {start:new Date().getTime()};
    if (targetinfo.hasOwnProperty('protocol')) {
        if (targetinfo.protocol == 'http:') {
            agent = require('http');
            //logger.log('info',"check_audio: Using http");
        } else if (targetinfo.protocol == 'https:') {
            agent = require('https');
            //logger.log('info',"check_audio: Using https");
        } else {
            //logger.log('info',"check_audio: Invalid protocol: "+targetinfo.protocol);
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'Invalid protocol';
            if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
            resultobj.process(jobinfo, true);
            return true;
        }
    } else {
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid URL';
        if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
        resultobj.process(jobinfo, true);
        return true;
    }
    targetinfo.agent = false;
    //logger.log('info',"check_audio: Url for job "+jobinfo._id+" is "+jobinfo.parameters.target);
    var killit = false;
    var gotSocket = false;
    var timeout = config.timeout * 1;
    var defaulttimeout = config.timeout * 1;
    if (jobinfo.parameters.threshold) {
        defaulttimeout = 1000 * parseInt(jobinfo.parameters.threshold);
        if (defaulttimeout > 90000) defaulttimeout = 90000;
        timeout = defaulttimeout + 2000;
    }
    try {
        var timeoutid = setTimeout(function() {
            if (killit) {
                return true;
            }
            killit = true;
            req.abort();
            logger.log('info',"check_audio: setTimeout called: "+timeout.toString()+ ", socket: "+sys.inspect(gotSocket)+', jobid: '+sys.inspect(jobinfo._id));
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Timeout';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Timeout';
            if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
            resultobj.process(jobinfo);
            return true;
        }, timeout);
        var req = agent.request(targetinfo, function(res) {
            var body = '';
            //logger.log('info','check_audio: res inside is: '+sys.inspect(res));
            //res.setEncoding('utf8');
            res.connection.on('error', function () {
                //logger.log('info','error');
            });
            res.on('data', function(d) {
                //logger.log('info',"check_audio: Data inside is "+sys.inspect(d));
                body += d.toString('utf8');
                if (body.length > 3145728) {// 3MB limit
                    clearTimeout(timeoutid);
                    killit = true;
                    //logger.log('info','check_audio: Response has ended and total body is: '+sys.inspect(body));
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 413;
                    jobinfo.results.success = false;
                    jobinfo.results.message = '3MB file size exceeded on playlist';
                    if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
                    resultobj.process(jobinfo);
                    req.abort();
                    return true;
                }
            });
            res.on('end', function(){
                if (!killit) {
                    clearTimeout(timeoutid);
                    killit = true;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    //logger.log('info','check_audio: Response has ended and total body is: '+sys.inspect(body));
                    jobinfo.results.diag = {"http":{
                                                requestheaders:targetinfo.headers,
                                                responseheaders:res.headers,
                                                httpstatus:res.statusCode,
                                                httpserverip:req.connection.remoteAddress}
                                           };
                    //logger.log('info','Diag: '+sys.inspect(jobinfo.results.diag));
                    if (res.statusCode >=200 && res.statusCode < 399) {
                        // Did it take too long?
                        if (defaulttimeout < jobinfo.results.runtime) {
                            //logger.log('info','check_audio: Timeout: '+sys.inspect(defaulttimeout)+" is less than "+sys.inspect(jobinfo.results.runtime));
                            jobinfo.results.success = false;
                            jobinfo.results.message = 'Timeout getting playlist';
                            jobinfo.results.statusCode = 'Timeout';
                            if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
                            resultobj.process(jobinfo);
                            return true;
                        } else {
                            // Read the playlist and pull the first URL.
                            if (body && body !== '') {
                                var found = false;
                                var lines = body.split("\n");
                                if (lines && lines.length) {
                                    for (var l in lines) {
                                        if (playlisttype === 'pls') {
                                            if (lines[l].indexOf('File1=') === 0){
                                                lines[l] = lines[l].replace('File1=','');
                                                lines[l] = buildResourceUrl(lines[l], targetinfo);
                                                //logger.log('info','check_audio: pls playlist URL found: '+sys.inspect(lines[l]));
                                                jobinfo.parameters.target = lines[l];
                                                return check(jobinfo);
                                            }
                                        } else if (playlisttype === 'xspf') {
                                            // I hate xml.  Let's do this the redneck way.
                                            var chunks = lines[l].split('<location>');
                                            chunks = chunks[1].split('</location>');
                                            lines[l] = buildResourceUrl(chunks[0], targetinfo);
                                            //logger.log('info','check_audio: xspf playlist URL found: '+sys.inspect(lines[l]));
                                            jobinfo.parameters.target = lines[l];
                                            return check(jobinfo);
                                        } else if (lines[l].indexOf('#') !== 0 && lines[l] !== '') {
                                            //logger.log('info','check_audio: m3u playlist URL found: '+sys.inspect(lines[l]));
                                            found = lines[l];
                                            break;
                                        }
                                    }
                                    if (found) {
                                        jobinfo.parameters.target = buildResourceUrl(found, targetinfo);
                                        //logger.log('info','check_audio: playlist URL found: '+sys.inspect(jobinfo.parameters.target));
                                        return check(jobinfo);
                                    }
                                    jobinfo.results.success = false;
                                    jobinfo.results.message = 'No stream resource found in the playlist';
                                    if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
                                    resultobj.process(jobinfo);
                                } else {
                                    jobinfo.results.success = false;
                                    jobinfo.results.message = 'Unable to parse playlist';
                                    if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
                                    resultobj.process(jobinfo);
                                }
                            } else {
                                jobinfo.results.success = false;
                                jobinfo.results.message = 'Empty playlist returned';
                                if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
                                resultobj.process(jobinfo);
                            }
                            return true;
                        }
                    }else{
                        // Status code out of range.
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'HTTP status returned from playlist: '+res.statusCode;
                        if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
                        resultobj.process(jobinfo);
                        return true;
                    }
                }
                return true;
            });
            return true;
        });
        req.on("error", function(e){
            clearTimeout(timeoutid);
            if (!killit) {
                killit = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = e.toString();
                if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
                resultobj.process(jobinfo);
            }
            return true;
        }).on("timeout", function(to){
            clearTimeout(timeoutid);
            if (!killit) {
                killit = true;
                logger.log('info',"check_audio: Caught timeout: socket: "+sys.inspect(gotSocket)+', jobid: '+sys.inspect(jobinfo._id));
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout getting playlist';
                if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
                resultobj.process(jobinfo);
            }
            req.abort();
            return true;
        });
        req.on("socket", function (socket) {
            jobinfo.results = {start:new Date().getTime()};
            gotSocket = true;
            socket.emit("agentRemove");
        });
        req.end();
    } catch(ec) {
        clearTimeout(timeoutid);
        if (!killit) {
            if (req) req.destroy();
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Error';
            jobinfo.results.success = false;
            jobinfo.results.message = "Caught "+ec.toString();
            if (jobinfo.originaltarget) jobinfo.parameters.target = jobinfo.originaltarget;
            resultobj.process(jobinfo);
            killit = true;
        }
        return true;
    }
};

var buildResourceUrl = function (resource, targetinfo){
    resource = resource.replace("\r",'');
    resource = resource.replace("\n",'');
    // Check for relative and absolute paths as well as links
    if (resource.indexOf('http') === 0) {
        return resource;
    } else {
        if (resource.indexOf('/') === 0) {
            // Replace the whole pathname
            var toreplace = targetinfo.pathname;
            var pos = targetinfo.href.lastIndexOf(toreplace);
            if (pos > 7) {
                lines[l] = targetinfo.href.substring(0, pos) + resource;
            } else {
                logger.log('error',"check_audio: Weird placement for the last instance of: "+sys.inspect(toreplace)+" in "+sys.inspect(resource)+' for check target '+targetinfo.href);
            }
        } else {
            // tack this redirect on the end of the current path - removing the search, if any.
            if (targetinfo.pathname.slice(-1) !== '/') {
                // strip off the last filename if any.
                var pos = targetinfo.href.lastIndexOf('/');
                if (pos > 7) {
                    targetinfo.href = targetinfo.href.substring(0, pos);
                }
                resource = '/'+resource;
            }
            resource = targetinfo.href+resource;
        }
        return resource;
    }
};
