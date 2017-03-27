# Documentation page for multi-http-provider

Package that sits on top of web3 package by frozeman.
This package adds a MultiHttpProvider in the Web3 module:
This provider enables to connect to 1, 2 or more geth nodes simultaneously using the underlying HttpProvider of the web3 module. The provider has the following behavior
- It is initialized with an array of hosts, and establish connection with the first available.
- When an http request fails to reach the host (ie the geth node) the connection is considered dead and the connection is moved to the next available one. The onChange callback is raised. The failed request is sent again and result returned to the caller transparently.
- Any filter subscriptions active are resubscribed with the new node (transparently) and any callback will continue to work.


You need to run one or several local Ethereum node(s) to use this library.

## Installation

### Node.js

```bash
npm install multi-http-provider --save
```

### Meteor.js

```bash
meteor npm install multi-http-provider --save 
```

## Usage

Loading the packages. Second require will modify Web3.providers
```js
var Web3 = require('web3');
require('multi-http-provider'); // adds the MultiHttpProvider to the Web3.providers
```

Initializing and use Web3 API normally. Also see web3 package documentation
```js
let ethereum_url1 = "http://localhost:8545"; // node one
let ethereum_url2 = "http://localhost:8546"; // node two
web3 = new Web3(new Web3.providers.MultiHttpProvider([ethereum_url1, ethereum_url2], <optional timeout>));
console.log("Connected to Geth console", web3.version.node, "on block", eth.blockNumber);
eth.defaultAccount = eth.coinbase;
web3.personal.unlockAccount(eth.defaultAccount, "capture your password here", 10);

output: Connected to Geth console Geth/v1.5.8-stable-f58fb322/darwin/go1.7.5 on block 62353
```

Register a onChange callback:
- param 1 (multi): is the instance of the MultiHttpProvider
- param 2 (http) : is the instance of the HttpProvider currently connected with. If no node is available, this param is null.
```js
var onConnectionChange = function(multi, http){
			console.log("MultiHttpProvider changed to:",(http?http.host:"no connection"));
			}
web3.currentProvider.onChange(onConnectionChange);
```

## Documentation of internal attributes
Only the most relevant

### hosts
the array of hosts provided in construction. You can eventually modify this array dynamically.

### currentProvider
the current HttpProvider in use. will be "undefined" if no connection is available

### switchToNextConnected()
Function called automatically when the provider detects a connection issue with the current HttpProvider.
You can call this function yourself if you wish to switch manually (load balancing for instance)
When called, this function will (in that order)
- select the next available HttpProvider (meaning where a rpc call can be made)
- recreate all subscriptions (in synchronous calls) and store the new filterId (see below)
- call the onChange callbacks that have been registered.

### subscriptions
An object dictionary with the filterId registered (as available in the Filter object of the web3 module returned by the various filter and event functions)
it contains in front of each filterId a structure as follow:
- newId: the filterId in the current geth node (possibly different than the one the filter has been register into first)
- method: the geth rpc method used to create the filter
- params: the parameters provided to the node to create the filter.
see json rpc documentation of geth node for filter at https://github.com/ethereum/wiki/wiki/JSON-RPC#eth_newfilter
```
> web3.currentProvider.subscriptions
{ 
   '0x4e1e5457d84ef49a0ba97d972329dfd9': 
            { newId: '0x3a05fc1f64e0fd75d780a8319f01ba88',
              method: 'eth_newBlockFilter',
			params: [] } 
}
```
This structure allows to recreate the subscription to the new geth node when the connection switches 
and to map the original filterId (known by web3 module) with the current filterId known in the current geth node.
__DO NOT TAMPER THIS STRUCTURE UNLESS YOU KNOW WHAT YOU ARE DOING.__

### _traceMessage
set to true to activate the log on the console of the outbound and inbound messages as communicated to/from this provided
```
<-- { json message returned to web3 }
--> { json message received from web3 }
```


## Change log
### v 0.1.2
- correction of a bug that did not properly released the subscriptions
- addition of the internal field _traceMessage (default is false) to log on the console what the provider send and receive

[npm-image]: https://badge.fury.io/js/web3.png
[npm-url]: https://npmjs.org/package/web3
[travis-image]: https://travis-ci.org/ethereum/web3.js.svg
[travis-url]: https://travis-ci.org/ethereum/web3.js
[dep-image]: https://david-dm.org/ethereum/web3.js.svg
[dep-url]: https://david-dm.org/ethereum/web3.js
[dep-dev-image]: https://david-dm.org/ethereum/web3.js/dev-status.svg
[dep-dev-url]: https://david-dm.org/ethereum/web3.js#info=devDependencies
[coveralls-image]: https://coveralls.io/repos/ethereum/web3.js/badge.svg?branch=master
[coveralls-url]: https://coveralls.io/r/ethereum/web3.js?branch=master
[waffle-image]: https://badge.waffle.io/ethereum/web3.js.svg?label=ready&title=Ready
[waffle-url]: http://waffle.io/ethereum/web3.js

