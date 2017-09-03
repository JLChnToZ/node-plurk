"use strict";

var urlparse = require('url').parse;
var http = require('https');

var OAuth = require('oauth').OAuth;

var clientOAuthGen = function (https, consumerKey, consumerSecret) {
    if(!https) console.warn('HTTP for Plurk API is deprecated, Plurk is enforced to use HTTPS now.');
    var requestTokenUrl = "https://www.plurk.com/OAuth/request_token";
    var accessTokenUrl = "https://www.plurk.com/OAuth/access_token";
    return new OAuth(requestTokenUrl,
                     accessTokenUrl,
                     consumerKey,
                     consumerSecret,
                     "1.0",
                     null,
                     "HMAC-SHA1"
    );
};

// accessToken and accessToken are optional
var PlurkClient = function (https,
                            consumerKey, consumerSecret,
                            accessToken, accessTokenSecret) {
    this.endpoint = "https://www.plurk.com/";
    this.oAuth = clientOAuthGen(https, consumerKey, consumerSecret);
    this.accessToken = accessToken;
    this.accessTokenSecret = accessTokenSecret;
};

PlurkClient.prototype.getOAuthRequestToken = function (extraParams, cb) {
    return this.oAuth.getOAuthRequestToken(extraParams, cb);
};
PlurkClient.prototype.getOAuthAccessToken = function (oauth_token, oauth_token_secret, oauth_verifier, cb) {
    return this.oAuth.getOAuthAccessToken(
        oauth_token,
        oauth_token_secret,
        oauth_verifier,
        cb
    );
};
PlurkClient.prototype.getRequestToken = PlurkClient.prototype.getOAuthRequestToken;
PlurkClient.prototype.getAccessToken = PlurkClient.prototype.getOAuthAccessToken;


PlurkClient.prototype.getAuthPage = function (requestToken) {
    return "https://www.plurk.com/OAuth/authorize?oauth_token=" + requestToken;
};
PlurkClient.prototype.getAuthPageMobile = function (requestToken) {
    return "https://www.plurk.com/m/authorize?oauth_token=" + requestToken;
};

PlurkClient.prototype.join = function (path) {
    if (path.indexOf("/APP/") === 0) {
        return this.endpoint + path.substr(1);
    } else if (path.indexOf("APP/") === 0) {
        return this.endpoint + path;
    } else if (path.indexOf("/") === 0) {
        return this.endpoint + "APP" + path;
    } else {
        return this.endpoint + "APP/" + path;
    }
};

function boundCb (cb) {
    if (!cb) {
        return function () {}; // or return;
    }
    return function (err, json) {
        var data;
        try {
            data = JSON.parse(json);
        } catch (e) { // JSON.parse throws SyntaxError.
            if (err) {
                cb(err, json);
            } else {
                cb({error: e}, null);
            }
            return;
        }
        cb(err, data);
    };
}

// err is set to "missing new_offset" if any error occurred
function boundCometCb (cb, cometUrl) {
    if (!cb) {
        return function () {};
    }
    return function (err, jsonP) {
        if (err) {
            cb(err, jsonP);
            return;
        }
        var onError = function () {
            cb({error: "missing new_offset"}, jsonP);
        };
        var from = jsonP.indexOf('{');
        var to = jsonP.lastIndexOf('}') + 1;
        var json = jsonP.substring(from, to);
        var data;
        try {
            data = JSON.parse(json);
        } catch (e) {
            onError();
            return;
        }
        if (data["new_offset"] == null) {
            onError();
            return;
        }
        cb(err, data, cometUrl + "&offset=" + data["new_offset"]);
    };
}

/* rq(api, obj, function(err, data) [, accessToken, accessTokenSecret])
 */
PlurkClient.prototype.rq = function (api, obj, callback, accessToken, accessTokenSecret) {
    var path = this.join(api);
    if (accessToken == null) accessToken = this.accessToken;
    if (accessTokenSecret == null) accessTokenSecret = this.accessTokenSecret;
    this.oAuth.post(path, accessToken, accessTokenSecret, obj, boundCb(callback));
};

PlurkClient.prototype.post = function (api, accessToken, accessTokenSecret, obj, callback) {
    var path = this.join(api);
    this.oAuth.post(path, accessToken, accessTokenSecret, obj, boundCb(callback));
};

/* startComet(function(err, data, cometUrl) [, accessToken, accessTokenSecret])
 */
PlurkClient.prototype.startComet = function (callback, accessToken, accessTokenSecret) {
    this.rq('/APP/Realtime/getUserChannel', null, function (err, data) {
        if (err) {
            callback(err, data);
        } else {
            var cometUrl = data["comet_server"];
            if (cometUrl) {
                callback(err, data, cometUrl);
            } else {
                callback({error: "missing comet_server"}, data);
            }
        }
    });
};

/* comet(cometUrl, function(err, data, cometUrl))
 */
PlurkClient.prototype.comet = function (cometUrl, callback) {
    var TIMEOUT = 80000; // 80000ms is 80secs

    var parsedUrl = urlparse(cometUrl, true);
    parsedUrl.method = "GET";

    // Certificate used by comet channel seems to be untrusted and will throw error while polling
    parsedUrl.rejectUnauthorized = false;

    var channel = parsedUrl.query["channel"];
    var baseUrl = /[^?]+/.exec(cometUrl) + "?channel=" + channel;

    var hasError = false;
    var data = "";
    var cometCb = boundCometCb(callback, baseUrl);

    var request = http.request(parsedUrl, function (res) {
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            data += chunk;
        });
        res.on('end', function () {
            if (!hasError) {
                if (res.statusCode >= 200 && res.statusCode <= 299) {
                    cometCb(null, data); // HTTP OK
                } else {
                    cometCb({
                        statusCode: res.statusCode,
                        data: data
                    }, data); // Error
                }
            }
        });
    });
    request.setTimeout(TIMEOUT, function () {
        if (!hasError) {
            hasError = true;
            cometCb({error: "timeout"});
        }
    });
    request.on('error', function (e) {
        if (!hasError) {
            hasError = true;
            cometCb(e);
        }
    });
    request.end();
};

module.exports = PlurkClient;
