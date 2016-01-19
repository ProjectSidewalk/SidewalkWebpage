Activator template for Play Framework and the Slick database access library
This template helps building a classic web app or a JSON API

For a more complex example, see the [computer database sample](https://github.com/freekh/play-slick/tree/master/samples/computer-database)

# Setup
* Set up Play with Postgres and Slick. See this stackoverflow question for a hint: http://stackoverflow.com/questions/21272878/postgres-play-2-2-1-java-driver-not-found-org-postgresql-driver

# Examples
* Scala, Slick, Postgres: http://www.wiredmonk.me/rest-api-with-scala-play-slick-postgresql-redis-and-aws-s3.html
# "Play, Heroku and PostgreSQl seed": http://typesafe.com/activator/template/play-heroku-seed

# Upload
1. Use Play's dist tool to create jar files of the project: https://www.playframework.com/documentation/2.3.x/ProductionDist
2. Upload the zip file to the web server
3. Unarchive and execute the application that is in sidewalk-webpage-[version]/bin/
4. Sometimes the application tells you that port 9000 (i.e., default port for a Play app) is taken. To kill an application that is occupying the port, first identify pid with the netstat command `netstat -tulpn | grep :9000` and then use the `kill` command.
