var fs     = require('fs');
var crypto = require('crypto');
var mysql  = require('mysql');

var Steam            = require('steam');
var SteamWebLogOn    = require('steam-weblogon');
var getSteamAPIKey   = require('steam-web-api-key');
var SteamTradeOffers = require('steam-tradeoffers');

var logOnOptions = {
    account_name: '', // your login name
    password: '' // your login password
};

var authCode = ''; // code received by email

try {
    logOnOptions['sha_sentryfile'] = getSHA1(fs.readFileSync('sentry'));
} catch (e) {
    if (authCode != '') {
        logOnOptions['auth_code'] = authCode;
    }
}

if (fs.existsSync('servers')) {
    Steam.servers = JSON.parse(fs.readFileSync('servers'));
}

var steamClient   = new Steam.SteamClient();
var steamUser     = new Steam.SteamUser(steamClient);
var steamFriends  = new Steam.SteamFriends(steamClient);
var steamWebLogOn = new SteamWebLogOn(steamClient, steamUser);
var offers        = new SteamTradeOffers();

var connection = mysql.createConnection({
    host     : '', // mysql host
    user     : '', // mysql username
    password : '', // mysql password
    database : '', // mysql database
    connectTimeout: 0
});

connection.connect();

steamClient.connect(); // connect to the Steam network
steamClient.on('connected', function() {
    console.log("connected");
    steamUser.logOn(logOnOptions); // login to Steam
});

steamClient.on('logOnResponse', function(logonResp) {
    if (logonResp.eresult == Steam.EResult.OK) {
        console.log('Logged in!');
        steamFriends.setPersonaState(Steam.EPersonaState.Online); // set status to 'Online'
        steamFriends.setPersonaName('Choops 2'); // change name

        steamWebLogOn.webLogOn(function(sessionID, newCookie){
            getSteamAPIKey({
                sessionID: sessionID,
                webCookie: newCookie
            }, function(err, APIKey) {
                if (err) throw err;
                offers.setup({
                    sessionID: sessionID,
                    webCookie: newCookie,
                    APIKey: APIKey
                });
            });
        });
    }
});

steamClient.on('servers', function(servers) {
    fs.writeFile('servers', JSON.stringify(servers));
});

steamUser.on('updateMachineAuth', function(sentry, callback) {
    fs.writeFileSync('sentry', sentry.bytes);
    callback({ sha_file: getSHA1(sentry.bytes) });
});

steamUser.on('tradeOffers', function(number) {
    if (number > 0) {
        offers.getOffers({
            get_received_offers: 1,
            active_only: 1,
            time_historical_cutoff: Math.round(Date.now() / 1000)
        }, function(err, body) {
            if (err) throw err;
            if (body.response.trade_offers_received) {
                body.response.trade_offers_received.forEach(function(offer) {
                    if (offer.trade_offer_state == 2) {
                        var amount = 0;
                        if (offer.items_to_give == undefined) {
                            offers.acceptOffer({tradeOfferId: offer.tradeofferid});
                            console.log("> Accepting offer sent from " + offer.steamid_other);
                            offer.items_to_receive.forEach(function(current, index, array) {
                                amount++;
                            });
                            postToSQL("INSERT INTO donations (sid, amount) VALUES (" + offer.steamid_other + ", " + amount + ")");
                        } else {
                            console.log("> Declining offer sent from " + offer.steamid_other + " - item_to_give is not null");
                            offers.declineOffer({tradeOfferId: offer.tradeofferid});
                        }
                    }
                });
            }
        });
    }
});

function postToSQL(statement) {
    connection.query(statement, function(err) { 
        if (err) throw err; 
    });
}

function getSHA1(bytes) {
    var shasum = crypto.createHash('sha1');
    shasum.end(bytes);
    return shasum.read();
}
