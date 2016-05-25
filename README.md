# Sidewalk Webpage
The Project Sidewalk webpage.

## Development Instructions
### Setting up the development environment
Set up the development environment for Scala, JavaScript and Postgres.

1. Install JDK 7 (or above), Scala, and `activator` on your computer. See [the instruction](https://github.com/ProjectSidewalk/Instructions#java--scala)
2. Install Node.js. See [the instruction](https://github.com/ProjectSidewalk/Instructions#javascript);
3. On the top directory, run `npm install` to install all the JavaScript dependencies.
4. Set up the Postgres database by folloing the tutorial. See [the instruction on installing the Postgres database.](https://github.com/ProjectSidewalk/Instructions#postgresql)

### Running the Application Locally
To run the web server locally,

1. Make sure the Postgres is running locally on port 5432
2. Run `activator run` on the top directory where `build.sbt` is located. This should start the web server. Note that the first time compilation takes time.
3. Run `grunt watch` so the changes you make to SVLabel JavaScript library will be automatically copiled on file updates.

## Running the Application Remotely
To run the application remotely,

1. Use Play's dist tool to create jar files of the project (i,e., `activator dist`): https://www.playframework.com/documentation/2.3.x/ProductionDist
2. Upload the zip file to the web server
3. SSH into the server and unarchive the zip file (e.g., `unzip filename`).
4. Run `nohup bin/sidewalk-webpage-[version] -Dconfig.resource=application-prod.conf -Dhttp.port=9000 &` ([reference](http://alvinalexander.com/scala/play-framework-deploying-application-production-server)). Sometimes the application tells you that port 9000 (i.e., default port for a Play app) is taken. To kill an application that is occupying the port, first identify pid with the netstat command `netstat -tulpn | grep :9000` and then use the `kill` command.
