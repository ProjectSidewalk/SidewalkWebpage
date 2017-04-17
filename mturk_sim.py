from flask import Flask,redirect
app = Flask(__name__)

@app.route('/')
def hello_world():
    return 'Hello, World!'

@app.route('/post')
def test_post():
    if request.method == 'POST':
    	print "Succesful POST Request"
    	print request.form['assignmentId']

@app.route('/send_info')
def test_send_info():
	external_url = "localhost:9000"
	query_dict = {"assignmentId":"ASSIGNMENT_ID_NOT_AVAILABLE","hitId":"Some_HIT","turkSubmitTo":"localhost:5000/post","workerId":"Teja"}
	
	query_String = "?"
	count=1
	for k,v in query_dict.items():
		if(count>1):
			query_string = query_string + "&" + k + "=" + v
		else:
			query_string = query_string + k + "=" + v

	return redirect(external_url+query_string) #"?assignmentId=ASSIGNMENT_ID_NOT_AVAILABLE&hitId=Some_HIT&turkSubmitTo=localhost:5000/post&workerId=Teja"


if __name__ == "__main__":
    app.run(host='0.0.0.0',port=5000,debug=True)