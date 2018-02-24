line=$(head -n 1 /home/mikey/Dropbox/Sidewalk/testkeyfile.txt)
curl http://localhost:9000/audit/test/$line

