/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_whois.js
 * Basic whois check.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:10000              // Can be overriden by a parameter
};

var resultobj = require('../results.js');
var sys = require('util');
var logger = console;
var ipaddr = require('ipaddr.js');
var dns = require('dns');
var moment = require('moment');
var whois = require('whois');

var check = exports.check = function(jobinfo){
    //logger.log('info',"check_whois: Jobinfo passed to http check: "+sys.inspect(jobinfo));
    var timeout = config.timeout * 1;
    if(jobinfo.parameters.threshold){
        timeout = 1000 * parseInt(jobinfo.parameters.threshold);
        if (timeout > 90000) timeout = 90000;
    }
    if(jobinfo.debug) config.debug = jobinfo.debug;
    jobinfo.results = {start:new Date().getTime()};
    if(!jobinfo.parameters.target){
        logger.log('info',"check_whois: Missing domain name");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing Domain Name';
        resultobj.process(jobinfo, true);
        return true;
    }else{
        var connectionoptions = {"timeout":timeout, verbose:true};
        if (jobinfo.parameters.whoisserver){
            if (jobinfo.parameters.ipv6 && jobinfo.parameters.ipv6 !== 'false'){
                if (jobinfo.parameters.ipv6resolved){
                    connectionoptions.server = {host:jobinfo.parameters.ipv6resolved, port:43};
                    delete jobinfo.parameters.ipv6resolved;
                } else if (ipaddr.IPv6.isValid(jobinfo.parameters.whoisserver)){
                    connectionoptions.server = {host:jobinfo.parameters.whoisserver,port:43};
                } else {
                    // Resolve the whoisserver to an ipv6 address.
                    dns.resolve6(jobinfo.parameters.whoisserver,function(err,address){
                        if (err) {
                            logger.log('error', 'whois ipv6resolved: '+sys.inspect(err));
                            jobinfo.results.end = new Date().getTime();
                            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                            jobinfo.results.success = false;
                            jobinfo.results.statusCode = 'error';
                            jobinfo.results.message = 'Unable to resolve whois server to ipv6. '+sys.inspect(err);
                            resultobj.process(jobinfo);
                            return true;
                        }
                        if (address && address.length) {
                            logger.log('info', 'ipv6resolved: '+sys.inspect(address));
                            jobinfo.parameters.ipv6resolved = address[0];
                            return check(jobinfo);
                        }
                    });
                    return false;
                }
            } else {
                connectionoptions.server = {host:jobinfo.parameters.whoisserver,port:43};
            }
        }
        //logger.log('info',"check_whois: targetinfo: "+sys.inspect(targetinfo));
        var killit = false;
        var timeoutid = setTimeout(function() {
            if(killit){
                return true;
            }
            killit = true;
            logger.log('info',"check_whois: setTimeout called: "+timeout.toString());
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Timeout';
            jobinfo.results.success = false;
            resultobj.process(jobinfo);
            return true;
        }, timeout);
        try{
            //logger.log('info','whois connectionoptions: '+sys.inspect(connectionoptions));
            whois.lookup(jobinfo.parameters.target, connectionoptions, function(err,whoisData){
                if(killit){
                    return false;
                }
                killit = true;
                clearTimeout(timeoutid);
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                if (err){
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Error: '+sys.inspect(err);
                    jobinfo.results.statusCode = 'Error';
                } else if(whoisData && whoisData.length){
                    var parsed = false;
                    if (jobinfo.parameters.contentstring) {
                        var foundString = false;
                        for(var i in whoisData){
                            if (whoisData[i] && whoisData[i].data){
                                if (whoisData[i].data.indexOf(jobinfo.parameters.contentstring) > -1){
                                    foundString = true;
                                    jobinfo.results.message = 'WHOIS response matched';
                                    jobinfo.results.statusCode = 'Search term found in response';
                                    if (jobinfo.parameters.invert){
                                        jobinfo.results.success = false;
                                        
                                    } else {
                                        jobinfo.results.success = true;
                                    }
                                }
                            }
                        }
                        if (!foundString){
                            if (jobinfo.parameters.invert) {
                                jobinfo.results.success = true;
                            } else {
                                jobinfo.results.success = false;
                                logger.log('info','WHOIS response for '+jobinfo._id+': '+sys.inspect(whoisData));
                            }
                            jobinfo.results.message = 'Search term was not found in the WHOIS response';
                            jobinfo.results.statusCode = 'Search term not found';
                        }
                    } 
                    if (jobinfo.parameters.warningdays){
                        // Check for expiration date
                        var foundExpiration = false;
                        for(var i in whoisData){
                            if (whoisData[i] && whoisData[i].data && !foundExpiration){
                                whoisData[i].data =  parseWhoisData(whoisData[i].data);

                                for (var key in whoisData[i].data) {
                                    if (key.toLowerCase().includes('expir') || key.toLowerCase().includes('renew')) {
                                        //logger.log('info','We found what looks like expiration: '+sys.inspect(key)+sys.inspect(whoisData[i].data[key]));
                                        whoisData[i].data[key] = whoisData[i].data[key].replace('CLST',''); // weird timezone for .cl TLD
                                        var expiration = moment(whoisData[i].data[key]);
                                        if (expiration.isValid()){
                                            foundExpiration = true;
                                            //logger.log('info','WHOIS expiration: '+sys.inspect(expiration.toString()));
                                            var warningTime = moment(expiration).subtract(jobinfo.parameters.warningdays, "days");
                                            //logger.log('info','WHOIS expiration warning: '+sys.inspect(expiration.toString()));
                                            if (expiration < moment()){
                                                jobinfo.results.statusCode = 'Expired';
                                                jobinfo.results.success = false;
                                                jobinfo.results.message = "Domain expired on "+expiration.toString();
                                                //logger.log('info','WHOIS expiration needs warning: '+sys.inspect(expiration.toString()));
                                            } else if (warningTime < moment()){
                                                jobinfo.results.statusCode = 'Expiration';
                                                jobinfo.results.success = false;
                                                jobinfo.results.message = "Domain set to expire on "+expiration.toString();
                                                //logger.log('info','WHOIS expiration needs warning: '+sys.inspect(expiration.toString()));
                                            } else if (!jobinfo.parameters.contentstring) {
                                                jobinfo.results.success = true;
                                                jobinfo.results.message = 'Domain Active';
                                                jobinfo.results.statusCode = 'Active';
                                            }
                                        } else {
                                            logger.log('error','WHOIS invalid expiration: '+sys.inspect(whoisData[i].data[key]));
                                            //logger.log('info','WHOIS response for '+jobinfo._id+': '+sys.inspect(whoisData));
                                            //jobinfo.results.statusCode = 'Expiration not found';
                                            //jobinfo.results.success = false;
                                            //jobinfo.results.message = "We were unable to parse the expiration date from the WHOIS response. Please contact support for help.";
                                        }
                                    }
                                }
                            }
                        }
                        if (!foundExpiration){
                            logger.log('error','WHOIS expiration not found');
                            logger.log('info','WHOIS response for '+jobinfo._id+': '+sys.inspect(whoisData));
                            jobinfo.results.statusCode = 'Expiration not found';
                            jobinfo.results.success = false;
                            jobinfo.results.message = "We were unable to find an expiration date from the WHOIS response. Please contact support for help.";
                        }
                    } else if (!jobinfo.parameters.contentstring) {
                        jobinfo.results.success = true;
                        jobinfo.results.message = 'WHOIS reply received';
                        jobinfo.results.statusCode = 'Response received';
                    }
                } else {
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Empty WHOIS reply received';
                    jobinfo.results.statusCode = 'Error';
                }
                resultobj.process(jobinfo);
                return true;
            });
        }catch(error){
            killit = true;
            clearTimeout(timeoutid);
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Error';
            jobinfo.results.success = false;
            jobinfo.results.message = "Caught "+error.toString();
            resultobj.process(jobinfo);
        }
        return true;
    }
    return true;
};

var parseWhoisData = function(rawData) {
    var result = {};
    var lines = rawData.split('\n');
    //console.log('lines',lines);
    lines.forEach(function(line){

        line = line.trim();
        if ( line && (line.includes(': ') || line.includes(':2'))) { // The ':20' is for .id TLD
            var lineParts = line.split(':');

            // 'Greater than' since lines often have more than one colon, eg values with URLs
            if ( lineParts.length >= 2 ) {
                var key = lineParts[0],
                    value = lineParts.splice(1).join(':').trim()

                // If multiple lines use the same key, combine the values
                if ( key in result ) {
                    if (typeof result[key] === 'string') {
                        result[key] = [result[key]];
                    }
                    result[key].push(value);
                    return
                }
                result[key] = value;
            }
        } else if ( line && line.includes('] ') ) {
            var lineParts = line.split(']');

            // 'Greater than' since lines often have more than one colon, eg values with URLs
            if ( lineParts.length >= 2 ) {
                var key = lineParts[0],
                    value = lineParts.splice(1).join(']').trim();

                // If multiple lines use the same key, combine the values
                if ( key in result ) {
                    if (typeof result[key] === 'string') {
                        result[key] = [result[key]];
                    }
                    result[key].push(value);
                    return
                }
                result[key] = value;
            }
        }
    });

    return result;
}
