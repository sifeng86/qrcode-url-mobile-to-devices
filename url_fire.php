<?php

?>
<!doctype html>
<html>
  <head>
    <title>Socket.io Test</title>
    <script src="https://cdn.socket.io/socket.io-1.4.5.js"></script>
    <script src="https://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.js"></script>
    <script type="text/javascript" src="http://jeromeetienne.github.io/jquery-qrcode/src/qrcode.js"></script>
    <script type="text/javascript" src="http://jeromeetienne.github.io/jquery-qrcode/src/jquery.qrcode.js"></script>
<script>

</script>
  </head>
  <body>
    <script>    
      var socket = io.connect('http://52.197.142.64:8080');
      function sent_url() {
      socket.emit('sent_url', {'token': "<?php echo $_GET['token'];?>",'url': $('#url').val()});
      }
    
      socket.on('result', function(data){
        if(data.result=="success") {
             window.close();
        }      
      });

      /*
      $(document).ready(function(){
        $('#text').keypress(function(e){
          socket.emit('client_data', {'letter': String.fromCharCode(e.charCode)});
        });
      });
      */
    </script>
     <div id="date">
        <label>URL:</label>
        <input name="url" type="text" id="url"/> <br>
        
        <input name="send" id="send" onclick="sent_url()" type="button" value="send"/>
    </div>
    <input name="show" type="text" id="show" disabled/> <br>
    <div id="text"></div>
  </body>
</html>