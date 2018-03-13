/**
 * Created by Joe on 18/03/12.
 */
var express = require('express');
var router = express.Router();
var os = require('os')
var moment = require('moment');
moment.locale("zh-CN");
var _ = require('lodash');
var async = require('async');
var addresses = require('./config');

var Influx = require('influx')
var moment = require('moment');
var cheerio = require('cheerio');
var superagent = require('superagent');

const influx = new Influx.InfluxDB({
    host: 'influxdb',
    database: 'express_response_db',
    schema: [
        {
            measurement: 'miner_status',
            fields: {
                offlist: Influx.FieldType.STRING,
                liverate: Influx.FieldType.STRING,
                total: Influx.FieldType.INTEGER,
                offline: Influx.FieldType.INTEGER,
                online: Influx.FieldType.INTEGER,
                hashes_last_day: Influx.FieldType.INTEGER,
                ethValue: Influx.FieldType.FLOAT,
                hashrate: Influx.FieldType.INTEGER
            },
            tags: [
                'name',
                'address'
            ]
        }
    ]
})

influx.getDatabaseNames()
    .then(names => {
        if (!names.includes('express_response_db')) {
            return influx.createDatabase('express_response_db');
        }
    })
    .then(() => {

    })
    .catch(err => {
        console.error(`Error creating Influx database!`);
    })

/**
	*    *    *    *    *    *
	┬    ┬    ┬    ┬    ┬    ┬
	│    │    │    │    │    |
	│    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
	│    │    │    │    └───── month (1 - 12)
	│    │    │    └────────── day of month (1 - 31)
	│    │    └─────────────── hour (0 - 23)
	│    └──────────────────── minute (0 - 59)
	└───────────────────────── second (0 - 59, OPTIONAL)
 */
var schedule = require('node-schedule');

// f2pool鱼池
schedule.scheduleJob('*/30 * * * * *', function () {
    fetchFishPoolData();
});

//ethfans星火
schedule.scheduleJob('*/30 * * * * *', function () {
    fetchEthfansPoolData();
});

// bw币网
schedule.scheduleJob('*/30 * * * * *', function () {
    fetchBwPoolData();
});

//dwarfpool
schedule.scheduleJob('*/30 * * * * *', function () {
    fetchDwarfPoolData();
});

//btc.com
schedule.scheduleJob('*/30 * * * * *', function () {
    fetchBTCPoolData();
});


function fetchFishPoolData() {

    _.each(addresses.fish, function (address) {
        console.log(`The fish pool ${address} scheduleJob run`, moment().format('YYYY-MM-DD HH:mm:ss'));
        async.waterfall([
            function (callback) {
                var helpUrl = "https://www.f2pool.com/help"
                superagent.get(helpUrl).end(function (err, sres) {
                    // 常规的错误处理
                    if (err) {
                        return callback(err);;
                    }
                    var $ = cheerio.load(sres.text);
                    var trs = $('#miner-overview tbody tr');
                    var tds = $(trs[4]).find("td");
                    var html = $(tds[4]).text();
                    var strs = html.split(" ");
                    callback(null, strs[0]);
                });
            },

            function (ethValue, callback) {

                var apiUrl = `http://api.f2pool.com/eth/${address}`;

                superagent.get(apiUrl).end(function (err, sres) {
                    // 常规的错误处理
                    if (err) {
                        return callback(err);
                    }

                    var result = {};
                    result.tag = "fish";
                    result.address = address;
                    var offlines = [];
                    var obj = sres.body;
                    var worker_length = obj.worker_length; //实际总量
                    var worker_length_online = obj.worker_length_online; //在线
                    var hashes_last_day = obj.hashes_last_day; //过去24小时算力
                    var hashrate = obj.hashrate; //当前算力
                    result.hashes_last_day = hashes_last_day;
                    result.hashrate = hashrate;
                    result.ethValue = ethValue;
                    _.each(obj.workers, function (worker) {
                        var name = worker[0];
                        var lasttime = worker[6];
                        var lastCommit = moment(lasttime).format('YYYY-MM-DD HH:mm:ss');
                        var totalLeave = moment().diff(moment(lasttime), 'minutes')
                        if (totalLeave >= 10) {
                            offlines.push({
                                name: name,
                                lastCommit: lastCommit,
                                since: moment(lasttime).fromNow()
                            })
                        }
                    })

                    result.total = worker_length;

                    //是否需要翻页
                    if (obj.workers && obj.workers.length < worker_length) {
                        var start_worker = obj.workers[obj.workers.length - 1];
                        apiUrl = apiUrl + "?start_worker=" + start_worker[0];

                        superagent.get(apiUrl).end(function (err, sres) {
                            // 常规的错误处理
                            if (err) {
                                return callback(err);
                            }

                            var obj = sres.body;
                            var worker_length = obj.worker_length; //实际总量
                            var worker_length_online = obj.worker_length_online; //在线
                            _.each(obj.workers, function (worker) {
                                var name = worker[0];
                                var lasttime = worker[6];
                                var lastCommit = moment(lasttime).format('YYYY-MM-DD HH:mm:ss');
                                var totalLeave = moment().diff(moment(lasttime), 'minutes')
                                if (totalLeave >= 10) {
                                    offlines.push({
                                        name: name,
                                        lastCommit: lastCommit,
                                        since: moment(lasttime).fromNow()
                                    })
                                }
                            })
                            result.offlines = offlines;
                            callback(null, result);
                        });

                    } else {
                        result.offlines = offlines;
                        callback(null, result);
                    }
                });
            },

        ], function (err, result) {
            if (!err) {
                writeDB(result);
            }
        });
    })
}



function fetchEthfansPoolData() {

    _.each(addresses.ethfans, function (address) {
        console.log(`The ethfans pool ${address} scheduleJob run`, moment().format('YYYY-MM-DD HH:mm:ss'));

        async.waterfall([
            function (callback) {
                var ethValueUrl = "https://eth.ethfans.org/api/miner/featureIncome"

                superagent.get(ethValueUrl).end(function (err, sres) {
                    // 常规的错误处理
                    if (err) {
                        return callback(err);
                    }
                    var ethValue = sres.body.data.income1d / 10000 / 10000 / 10000
                    callback(null, ethValue);
                });
            },

            function (ethValue, callback) {

                var fetchUrl = `https://eth.ethfans.org/api/page/miner?value=${address.slice(2)}`
                console.log(fetchUrl);
                superagent.get(fetchUrl)
                    .end(function (err, sres) {
                        // 常规的错误处理
                        if (err) {
                            console.error(err)
                            return callback(err);
                        }
                        var obj = sres.body;
                        var result = {};
                        result.tag = "ethfans";
                        result.address = address;
                        result.hashes_last_day = obj.hashrate.data.meanHashrate24H;
                        result.hashrate = obj.hashrate.data.hashrate;
                        result.ethValue = ethValue;
                        var total = obj.workers.data.length;

                        var offlines = [];
                        _.each(obj.workers.data, function (work) {
                            if (work.hashrate === 0) {
                                var lastCommit = moment(work.time).format('YYYY-MM-DD HH:mm:ss');
                                offlines.push({
                                    name: work.rig,
                                    lastCommit: lastCommit,
                                    since: moment(lastCommit).fromNow()
                                })
                            }
                        })
                        result.total = total;
                        result.offlines = offlines;

                        callback(null, result)
                    });

            },

        ], function (err, result) {
            if (!err) {
                writeDB(result);
            }
        });
    })

}



function fetchBwPoolData() {
    _.each(addresses.bw, function (address) {
        console.log(`The bw pool ${address} scheduleJob run`, moment().format('YYYY-MM-DD HH:mm:ss'));

        async.waterfall([
            function (callback) {
                var ethValueUrl = "https://eth.bw.com/pool/i"

                superagent.get(ethValueUrl).end(function (err, sres) {
                    // 常规的错误处理
                    if (err) {
                        return callback(err);
                    }

                    var $ = cheerio.load(sres.text);
                    var offlines = []
                    var h3s = $('.difficulty .item h3');
                    var ethValue = $(h3s[3]).text().split(" ")[0]
                    callback(null, ethValue);

                });
            },

            function (ethValue, callback) {

                var fetchUrl = `https://eth.bw.com/pool/group/ajax?coint=btc&page=1&tab=2&ltype=0&groupId=0&pageSize=10000&orderstr=&name=&gtForce=&ltForce=&addr=${address}`
                superagent.get(fetchUrl)
                    .end(function (err, sres) {
                        // 常规的错误处理
                        if (err) {
                            console.error(err)
                            return;
                        }

                        var result = {};
                        var total = 0;
                        var $ = cheerio.load(sres.text);
                        var offlines = []
                        var trs = $('tbody tr');
                        $(trs).each(function (idx, element) {
                            var $element = $(element);
                            var tds = $element.find("td");

                            var name = $(tds[0]).text();
                            var num = $(tds[1]).text().split(" ")[0]
                            var currentNum = num - 0

                            if (currentNum === 0) {
                                var lastCommit = moment($(tds[4]).text()).format('YYYY-MM-DD HH:mm:ss');
                                offlines.push({
                                    name: name,
                                    lastCommit: lastCommit,
                                    since: moment(lastCommit).fromNow()
                                })
                            }

                            total += num - 0;

                        });

                        result.tag = "bw"
                        result.address = address
                        result.hashes_last_day = total;
                        result.hashrate = total;
                        result.ethValue = ethValue;
                        result.offlines = offlines;
                        result.total = trs.length;

                        callback(null, result)
                    });

            },

        ], function (err, result) {
            if (!err) {
                writeDB(result);
            }
        });

    });
}


function fetchDwarfPoolData() {

    _.each(addresses.dwarfpool, function (address) {
        console.log(`The dwarfpool ${address} scheduleJob run`, moment().format('YYYY-MM-DD HH:mm:ss'));

        async.waterfall([
            
            function (callback) {
                var helpUrl = `http://dwarfpool.com/eth/api?wallet=${address}`;
                superagent.get(helpUrl).end(function (err, sres) {
                    // 常规的错误处理
                    if (err) {
                        return callback(err);
                    }
                    var total = 0;  //算力
                    var result = {};
                    var offlines = [];
                    result.tag = "dwarfpool";
                    result.address = address;

                    var obj = sres.body;
                    var ethValue = obj.earning_24_hours;
                    var workers = obj.workers;
                    var totalWork = 0;
                    _.each(workers, function (work) {

                        if (!work.alive) {
                            var lastCommit = moment(work.last_submit).format('YYYY-MM-DD HH:mm:ss');
                            offlines.push({
                                name: work.worker,
                                lastCommit: lastCommit,
                                since: moment(lastCommit).fromNow()
                            })
                        }
                        total += work.hashrate;
                        totalWork++;
                    })

                    result.hashes_last_day = total;
                    result.hashrate = total;
                    result.ethValue = ethValue;
                    result.offlines = offlines;
                    result.total = totalWork;

                    callback(null, result)
                });
            },

        ], function (err, result) {
            if (!err) {
                writeDB(result);
            }
        });
    })
}


function fetchBTCPoolData() {

    _.each(addresses.btc, function (address) {
        console.log(`The btccom ${address} scheduleJob run`, moment().format('YYYY-MM-DD HH:mm:ss'));

        async.waterfall([
            function (callback) {
                var ethValueUrl = `https://cn-pool.api.btc.com/v1/coins-income?access_key=${address}&puid=71095&lang=zh-cn`

                superagent.get(ethValueUrl).end(function (err, sres) {
                    // 常规的错误处理
                    if (err) {
                        return callback(err);
                    }

                    var btc = sres.body.data.btc;
                    var ethValue = btc.income_coin.toFixed(12);
                    callback(null, ethValue);

                });
            },

            function (ethValue, callback) {
                var helpUrl = `https://cn-pool.api.btc.com/v1/worker/?group=0&page=1&page_size=50&status=all&order_by=worker_name&asc=1&filter=&access_key=${address}&puid=71095&lang=zh-cn`
                superagent.get(helpUrl).end(function (err, sres) {
                    // 常规的错误处理
                    if (err) {
                        return callback(err);
                    }
                    var total = 0;  //算力
                    var totalAvg = 0;
                    var result = {};
                    var offlines = [];
                    result.tag = "btccom";
                    result.address = address;

                    var pageCount = sres.body.data.page_count

                    var workers = []
                    async.timesLimit(pageCount, 5, function (n, next) {
                        var helpUrl = `https://cn-pool.api.btc.com/v1/worker/?group=0&page=${n + 1}&page_size=50&status=all&order_by=worker_name&asc=1&filter=&access_key=${address}&puid=71095&lang=zh-cn`
                        superagent.get(helpUrl).end(function (err, sres) {
                            if (err) {
                                return next(err);
                            }
                            if (sres.body && sres.body.data && sres.body.data.data) {
                                workers = _.concat(workers, sres.body.data.data);
                            }

                            next(err);
                        })

                    }, function (err) {

                        _.each(workers, function (work) {
                            if (work.status === "INACTIVE") {
                                var lastCommit = moment(work.last_share_time * 1000).format('YYYY-MM-DD HH:mm:ss');
                                offlines.push({
                                    name: work.worker_name,
                                    lastCommit: lastCommit,
                                    since: moment(lastCommit).fromNow()
                                })
                            }
                            total += work.shares_1m - 0;
                            totalAvg += work.shares_1d - 0;
                        })

                        result.hashes_last_day = totalAvg;
                        result.hashrate = total;
                        result.ethValue = ethValue;
                        result.offlines = offlines;
                        result.total = workers.length;
                        callback(null, result)
                    });
                });
            },
        ], function (err, result) {
            if (!err) {
                writeDB(result);
            }
        });
    })
}


function writeDB(result) {
    result.online = result.total - result.offlines.length;
    result.offline = result.offlines.length;
    result.liverate = "0.00%"
    if(result.online>0 && result.total>0){
        result.liverate = (result.online / 1.0 / result.total * 100).toFixed(2) + "%";
    }
    
    console.log(result);
    // 把offlines转成字符串
    result.offlines = _.map(result.offlines, function (element) {
        return element.name + ", 上次提交: " + element.lastCommit + ", " + element.since;
    })
    influx.writePoints([
        {
            measurement: 'miner_status',
            tags: { name: result.tag, address: result.address },
            fields: {
                liverate: result.liverate,
                offlist: result.offlines.join("\r\n"),
                total: result.total,
                online: result.online,
                offline: result.offline,
                hashes_last_day: result.hashes_last_day,
                hashrate: result.hashrate,
                ethValue: result.ethValue
            },
        }
    ]).catch(err => {
        console.error(`Error saving data to InfluxDB! ${err.stack}`)
    })
}

module.exports = router;