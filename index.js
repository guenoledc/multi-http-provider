
//#########################################################################################
// ETHEREUM FUNCTIONS
// Created by G. de Cadoudal - march 2017
// adds functions and objects to the web3 instance by modifying Web3 prototype
//#########################################################################################

var srchInModules=function(mod, exportName){
	//console.log("search module", (mod.exports?mod.exports.name:"No exports"), mod.id);
	if(mod.exports && mod.exports.name==exportName)
		return mod.exports;
	else if(mod.children)
		for(var i=0; i<mod.children.length; i++) {
			var o = srchInModules(mod.children[i], exportName);
			if(o) return o;
		}
	return null;
};
var srch2InModules=function(mod, pathPart){
	//console.log("search module", mod.filename);
	if( mod.filename && mod.filename.indexOf(pathPart)>=0)
		return mod.exports;
	else if(mod.children)
		for(var i=0; i<mod.children.length; i++) {
			var o = srch2InModules(mod.children[i], pathPart);
			if(o) return o;
		}
	return null;
};
var isArray = function (object) {
	return object instanceof Array;
};

// assumes that the web3 variable is initialized outside this package and connected to a node.
if(!module.parent) {console.log("use require() to load this package"); return; }
//console.log("loading web3");
var Web3 = module.parent.require('web3');
var Jsonrpc = srch2InModules(module.parent, "web3/lib/web3/jsonrpc"); // to get the counter and create new rpc
/* USAGE

 var MultiProvider= new MultiHttpProvider(["http://localhost:8545", "http://localhost:8546"], 0);
 web3 = new Web3(MultiProvider);
 
 */

// this to simplify the logic of mapping
var subscriptionMethods = {
	eth_newFilter:'new',
	eth_newBlockFilter:'new',
	eth_newPendingTransactionFilter:'new',
    eth_uninstallFilter:'del',
    eth_getFilterChanges:'map',
    eth_getFilterLogs:'map'
}

var MultiHttpProvider = function(hosts, timeout) {
	this.hosts= hosts;
	this.current = -1;
	this.timeout = timeout;
	this.currentProvider=undefined;
	this._callbacks = [];
	this._traceMessage=false;
	this.providers=hosts.map(function(host) {
							 return new Web3.providers.HttpProvider(host, timeout);});
	this.subscriptions = {}; // will contains subscriptions detected via the subscription rpc methods, each obj being
							// xxxx: {newId:yyyy, method:'one of new method', params:[....]}
	this.switchToNextConnected();
}

// callback must be function(MultiHttpProvider, HttpProvider)
MultiHttpProvider.prototype.onChange = function(callback) {
	if(callback) this._callbacks.push(callback);
}

MultiHttpProvider.prototype.prepareRequest = function (async) {
	if(this.currentProvider) {
		return this.currentProvider.prepareRequest(async);
	} else {
		if( this.switchToNextConnected() )
			return this.prepareRequest(async); // we connected so call again
		else // it has not been possible to find a valid connection
			throw new Error('CONNECTION ERROR: Couldn\'t connect to any of the nodes '+ this.hosts +'.');
	}
}

var cloneFilterPayload = function(payload) {
	var result={ jsonrpc:null, id: null, method:null, params:[]};
	result.jsonrpc=payload.jsonrpc;
	result.id=payload.id;
	result.method=payload.method;
	result.params = payload.params.map(function(e){return e;});
	return result;
}

MultiHttpProvider.prototype.subscriptionChannelOut = function(payload) { // returns modified payload
	// recurse if we have an array of json requests
	var self=this;
	if(isArray(payload)) return payload.map(function(p){return self.subscriptionChannelOut(p);});
	// we do not have an array, process one
	//console.log("ChannelOut before:",payload.method, payload.params[0]);
	var action=null;
	if( action=subscriptionMethods[payload.method] ) {
		if(action=='new') this.subscriptions[payload.id]={newId:null, method:payload.method, params:payload.params}
		if(action=='del') delete this.subscriptions[payload.params[0]];
		if(action=='map') {
			var filterId = payload.params[0];
			var sub;
			if( sub=this.subscriptions[filterId] ) {
				//console.log("Mapping", filterId, "to", sub.newId);
				var newPayload = cloneFilterPayload(payload);
				newPayload.params[0]=sub.newId; // do the mapping to the new id if there was a change of node
				return newPayload;
			}
		}
	}
	//console.log("subsChannelOut.action", action, subscriptionMethods[payload.method], payload);
	return payload;
}
MultiHttpProvider.prototype.subscriptionChannelIn = function(result) { // returns modified payload
	// recurse if we have an array of json responses
	var self=this;
	if(isArray(result)) return result.map(function(r){return self.subscriptionChannelIn(r);});
	// we do not have an array, process one
	var sub;
	if( sub=this.subscriptions[result.id] ) { // this is the rpc response of a request we kept for outbound processing
		// result.result is the node result.
		delete this.subscriptions[result.id]; // remove this pending request
		// install the subscription if successful
		if( result.result) {
			sub.newId=result.result;
			this.subscriptions[result.result]=sub;
		}
	}
	return result;
}
MultiHttpProvider.prototype.subscriptionChannelOutIn = function(payload) {
	return this.subscriptionChannelIn( this.currentProvider.send( this.subscriptionChannelOut(payload)) );
}

MultiHttpProvider.prototype.resubscribeAll = function() {
	if(!this.currentProvider) return; // cannot resubscribe without a valid provider
	for(subkey in this.subscriptions){
		var sub = this.subscriptions[subkey];
		if(sub.newId) { // to filter out the pending requests
			var payload = Jsonrpc.toPayload(sub.method, sub.params);
			try {
				//console.log("Resubscribing", payload);
				var result = this.currentProvider.send(payload); // call it synch
				//console.log("Resubscribing result", result);
				if(result.result) sub.newId=result.result; // replace with the new filterId
				else delete this.subscriptions[subkey]; // cannot subscribe, remove this subscription
			} catch(error) { delete this.subscriptions[subkey]; } // probably a communication pb.
		} else delete this.subscriptions[subkey]; // it was a pending request not registered, then the Filter didn'd have an id.
	}
}

var logMsg = function(result, out, active) {
	if(active) console.log((out?"-->":"<--"), result);
	return result;
}
MultiHttpProvider.prototype.send = function (payload) {
	if(this.currentProvider) {
		try {
			//console.log("Send:", payload);
			return logMsg( this.subscriptionChannelOutIn( logMsg( payload, true, this._traceMessage)
														 ) , false, this._traceMessage );
		} catch(error) {
			console.log("Error with host "+this.currentProvider.host+". Switching to the next", error);
			if(this.switchToNextConnected())
				return this.send(payload); // try the next connection
			else throw new Error('CONNECTION ERROR: Couldn\'t connect to any of the nodes '+ this.hosts +'.');
		}
	} else {
		if(this.switchToNextConnected()) {
			return this.send(payload); // try the next connection
		} else throw new Error('CONNECTION ERROR: Couldn\'t connect to any of the nodes '+ this.hosts +'.');
	}
}


MultiHttpProvider.prototype.sendAsync = function (payload, callback) {
	// Caveat: When the callback is supposed to be called several times over time (eg eth.filter, eth.watch)
	// the node can be put down and then the callback returns an error.
	// the end user must process that error to renew the subscription on a different node.
	var internalCallback = function(err, result) {
		callback(err, logMsg( this.subscriptionChannelIn( result ), false, this._traceMessage ));
	}
	if(this.isConnected()) {// first check that there is a connection in synchronous mode
		payload = this.subscriptionChannelOut( logMsg( payload , true, this._traceMessage) );
		this.currentProvider.sendAsync( payload, internalCallback.bind(this));
	} else callback(new Error('CONNECTION ERROR: Couldn\'t connect to any of the nodes '+ this.hosts +'.'), undefined);
}


MultiHttpProvider.prototype.isConnected = function() {
	if(this.currentProvider)
		if(this.currentProvider.isConnected()) return true;
		else { this.switchToNextConnected(); return this.currentProvider!=undefined;}
		else { this.switchToNextConnected(); return this.currentProvider!=undefined;}
}

MultiHttpProvider.prototype.switchToNextConnected = function() {
	var self=this;
	var initial=this.current; // current index of provider before we switch
	// if there is no available provider the loop does nothing
	for(var i=1; i<=this.providers.length; i++ ) {
		this.current++; // move to next one. the first time it moves from -1 to 0;
		// if we have gone over the nb of provider revert to 0;
		if(this.current>=this.providers.length) this.current=0;
		if(this.providers[this.current].isConnected()) {
			this.currentProvider=this.providers[this.current];
			this.resubscribeAll(); // force resubscription of all existing subscriptions
			if(initial!=this.current) // we have changed
				this._callbacks.forEach(function(cb){try{cb(self, self.currentProvider);}catch(err){}});
			return true;
		}
	}
	this.current=-1;
	this.currentProvider=undefined;
	//console.log("MultiHttpProvider could not find an active node in ", this.hosts);
	if(initial!=this.current) // we have changed
		this._callbacks.forEach(function(cb){try{cb(this, null);}catch(err){}});
	return false;
}

// register the provider in Web3
Web3.providers.MultiHttpProvider = MultiHttpProvider;

