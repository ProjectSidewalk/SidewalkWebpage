Readme for the mturk-v2 branch

This branch can be used to run Mturk experiments over pre-generated routes. 
Currently there is only one type of experiment that can be run: fixed distance with the same interface as the develop branch.

- Move the .pgpass file in the main folder of this branch to your home directory. It has the connection config for the postgres database. You can modify this if necessary.
- Generate the routes using the create_routes.py program. You may need to install some python libraries in order to run this. This is a manual process currently. Do not change the mission distance and other parameters for now. The program will generate 30 routes around 1000ft in length
- Run the hit_creation_sim.py program to simulate creating hits and assigning a route to each of them. Currently the number of HITs generated is equal to the number of routes and there is a 1-to-1 mapping between them. The hitId is the same as routeId when you run this program.
- Check that the amt_route_assignment, route, route_street, and amt_condition tables exist and are populated. The amt_assignment table will get populated as and when you start the audits.
- Run the branch locally. 
- To audit a particular route go to "localhost:9000/?assignmentId=<random_string>&hitId=<some_route_id>&workerId=<random_string>&turkSubmitTo=http://localhost:9000/audit"