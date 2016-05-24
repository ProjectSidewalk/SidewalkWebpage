# Sidewalk Webpage
The webpage

## Setup
Set up the development environment for Scala, JavaScript and Postgres. See [Java & Scala, JavaScript, and Postgres parts in the instruction page.](https://github.com/ProjectSidewalk/Instructions)

## Running the Application Locally
Run `sbt run` or `activator run` on the directory where `build.sbt` is located.

## Running the Application Remotely
1. Use Play's dist tool to create jar files of the project (i,e., `activator dist`): https://www.playframework.com/documentation/2.3.x/ProductionDist
2. Upload the zip file to the web server
3. SSH into the server and unarchive the zip file (e.g., `unzip filename`).
4. Run `nohup bin/sidewalk-webpage-[version] -Dconfig.resource=application-prod.conf -Dhttp.port=9000 &` ([reference](http://alvinalexander.com/scala/play-framework-deploying-application-production-server)). Sometimes the application tells you that port 9000 (i.e., default port for a Play app) is taken. To kill an application that is occupying the port, first identify pid with the netstat command `netstat -tulpn | grep :9000` and then use the `kill` command.

## Development Instructions

Whenever you are working on the client side code and server side code,
you should keep running the local server and `grunt watch`. Either
run a script like `node run.js` to execute these processes or run each of them
one by one as described below.

### Run the local server
Run `activator run` on the directory where `build.sbt` is located.

### Run JavaScript task runner
SVLabel&mdash;the image labeling interface to annotate Street View
imagery&mdash;needs to be built before being used on the web application.
To do this, run `grunt watch`, which reacts to changes in the source code and builds the source code under the SVLabel directory and run unit tests.
