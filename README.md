# Sidewalk Webpage
The Project Sidewalk webpage.

## Development Instructions

### Setting up the development environment
Set up the development environment for Scala, JavaScript and Postgres. The detailed instructions for each software component and more on server management instructions are provided [here](https://github.com/ProjectSidewalk/Instructions). You can start off using the steps below:

1. Install JDK 7 (or above), Scala, and `activator` on your computer. See detailed [instructions for installing Scala environment here](https://github.com/ProjectSidewalk/Instructions#java--scala).
2. Install Node.js. See detailed [instructions here](https://github.com/ProjectSidewalk/Instructions#javascript).
3. On the top directory, run `npm install` to install all the JavaScript dependencies.
4. Set up the Postgres database by folloing the tutorial. See detailed [instructions on installing the Postgres database here.](https://github.com/ProjectSidewalk/Instructions#postgresql)

### Running the Application Locally
To run the web server locally,

1. Make sure the Postgres is running locally on port 5432
2. Run `activator run` on the top directory where `build.sbt` is located. This should start the web server. 
Note that the first time compilation takes time.
3. For the web application to run, you have to build the JavaScript and CSS files. 
To do this, run `grunt watch` so the changes you make to SVLabel JavaScript library 
will be automatically built on file updates. If `grunt watch` is not responding,
you can run `grunt concat` and `grunt concat_css` to build the files.

## Running the Application Remotely
To run the application remotely,

1. Use Play's dist tool to create jar files of the project (i,e., `activator dist`): https://www.playframework.com/documentation/2.3.x/ProductionDist
2. Upload the zip file to the web server
3. SSH into the server and unarchive the zip file (e.g., `unzip filename`).
4. Run `nohup bin/sidewalk-webpage -Dhttp.port=9000 &` ([reference](http://alvinalexander.com/scala/play-framework-deploying-application-production-server)). Sometimes the application tells you that port 9000 (i.e., default port for a Play app) is taken. To kill an application that is occupying the port, first identify pid with the netstat command `netstat -tulpn | grep :9000` and then use the `kill` command.

## Deployment Related Docs (private - for team only)
- [Volunteer Recruitment](https://docs.google.com/document/d/1S0QkTX4OP1eMoIK6NZ5Cu2EpCV5Y3lTOf5lFiCqiItA/edit#heading=h.txqj819si9cz)
- [Responses and Feedback](https://docs.google.com/document/d/1e-Z9k2NL7hdgN2MZC8zIjwMohBl-xz7pta9vjCHQXnk/edit)
- [Server Notes](https://docs.google.com/document/d/1bXflDqd-hpFUdcrJUJzJh3CibgDJr_UGjAgxJz4OymU/edit)
