from flask import Flask,redirect,request
import requests

app = Flask(__name__)

@app.route('/')
def hello_world():
    return 'Hello, World!'

@app.route('/receives_post', methods=['POST'])
def test_recieves_post():
    print "Succesful POST Request"
    return request.form["applicationId"]

@app.route('/send_info')
def test_send_info():
	external_url = "localhost:9000/audit"
	query_dict = {"assignmentId":"ASSIGNMENT_ID_NOT_AVAILABLE","hitId":"Some_HIT","turkSubmitTo":"localhost:5000/recieves_post","workerId":"Teja"}
	
	query_string = "?"
	count=1
	for k,v in query_dict.items():
		if(count>1):
			query_string = query_string + "&" + k + "=" + v
		else:
			query_string = query_string + k + "=" + v
		count = count+1

	return redirect(external_url+query_string)

'''@app.route('/sends_post')
def test_sends_post():
	query_dict = {"assignmentId":"ASSIGNMENT_ID_NOT_AVAILABLE"}
	external_url = "localhost:5000/recieves_post"
	r = requests.post(external_url, data = query_dict)
	print r.text
'''
if __name__ == "__main__":
    app.run(host='0.0.0.0',port=5000,debug=True)