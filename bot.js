var fs     = require('fs');
var crypto = require('crypto');
var socket = require('socket.io-client')('http://localhost:3333');

var Steam            = require('steam');
var SteamWebLogOn    = require('steam-weblogon');
var getSteamAPIKey   = require('steam-web-api-key');
var SteamTradeOffers = require('steam-tradeoffers');

var logOnOptions = {
    account_name: '', // your login name
    password: '' // your login password
};

var keys = {};

if (fs.existsSync(logOnOptions.account_name + '.2fa')) {
    keys = JSON.parse(fs.readFileSync(logOnOptions.account_name + '.2fa'));
} else {
    console.log('[Error: No 2FA file found: ' + logOnOptions.account_name + '.2fa]');
}

logOnOptions['two_factor_code'] = SteamTotp.generateAuthCode(keys.shared_secret);
console.log("Using code: " + logOnOptions['two_factor_code']);

if (fs.existsSync('servers')) {
    Steam.servers = JSON.parse(fs.readFileSync('servers'));
}

var steamClient   = new Steam.SteamClient();
var steamUser     = new Steam.SteamUser(steamClient);
var steamFriends  = new Steam.SteamFriends(steamClient);
var steamWebLogOn = new SteamWebLogOn(steamClient, steamUser);
var offers        = new SteamTradeOffers();

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
                        if (offer.items_to_give === undefined) {
                            offers.acceptOffer({tradeOfferId: offer.tradeofferid});
                            console.log("> Accepting offer sent from " + offer.steamid_other);
                            
                            socket.emit('donation', { 'items': offer.items_to_receive });
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
