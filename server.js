var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var randomstring = require("randomstring");
var mysql = require('mysql');

var host = 'localhost';
var user = 'root';
var password = '';
var database = 'node_url';

var connection = mysql.createConnection({
  host: host,
  user: user,
  password: password,
  database: database
});
app.get('/', function(req, res){
  res.sendFile(__dirname + '/test.html');
});
app.get('/scan', function(req, res){
  res.sendFile(__dirname + '/qr.html');
}); 

http.listen(8080, function(){  
  connection.connect();
  console.log('listening on *:8080');
});


 
  io.on('connection', function (socket) {
      console.log("SocketID:"+socket.id);
    socket.on('hello', function (data) {
        console.log('message: ' + data.hello);
        var rand = randomstring.generate(25);
        var randomToken = {token: rand};
        console.log('a user connected');
        var table = 'url';
        var rand = randomstring.generate(25);
        var randomToken = {token: rand,socket_id:socket.id};
        connection.query('INSERT INTO ' + table + ' SET ?', randomToken, function (err, results) {
            if (err) {
                throw err;
            }
        });
        socket.emit('qrcode', {'qrcode': rand,'token_code':rand});
        console.log(rand);
    });
    
    socket.on('token', function (data) {
        console.log('message: ' + data.token);
        var token = data.token;
        var url = data.url;
        var table = 'url';
        var sqlData = {token:token};
        connection.query('SELECT * FROM ' + table + ' WHERE ?',sqlData, function(err, results, fields) {
          if (err) {
            throw err;
          }
          console.log(results[0].socket_id);
          io.to(results[0].socket_id).emit('goto', {'goto': url});
        });

        console.log(url);
    });
    
    socket.on('sent_url', function (data) {
        console.log('Fireurl SocketID: ' + data.token);
        var token = data.token;
        var url = data.url;
        var table = 'url';
        //update URL to Token field
        var sqlData1 = [url, token];
        connection.query('UPDATE ' + table + ' SET url = ? WHERE token = ?', sqlData1, function (err1, results1) {
            if (err1) {
                throw err1;
            }
        });
      
        var sqlData2 = {token:token};
        connection.query('SELECT * FROM ' + table + ' WHERE ?',sqlData2, function(err2, results2, fields2) {
          if (err2) {
            throw err2;
          }
          io.to(results2[0].socket_id).emit('goto', {'url': url});
          console.log('SENT URL SocketID: '+results2[0].socket_id);
          socket.emit('result', {'result': 'success'});
        });

        console.log(url);
    });
});






