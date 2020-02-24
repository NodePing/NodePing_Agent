/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

// Get the type of a thing.  typeof with added tests for null, array, and NaN
// See http://davidcaylor.com/2011/03/05/testing-variable-types-in-javascript/
var gettype = exports.gettype = function(thing){
  return (thing === null) ? "null" :
    (typeof thing == "object" && thing.length !== undefined) ? "array" :
    (typeof thing == "number" && isNaN(thing)) ? "NaN" :
    typeof thing;
};

var isEmptyObject =  exports.isEmptyObject = function(obj){
    for(var prop in obj) {
        if(obj.hasOwnProperty(prop))
            return false;
    }
    return true;
};

var isNumeric = exports.isNumeric = function(n){
  return !isNaN(parseFloat(n)) && isFinite(n);
};