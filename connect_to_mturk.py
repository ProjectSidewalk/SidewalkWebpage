import boto3

def connect_to_mturk():
    # Get key from an external file
    secret_key = {}

    with open("rootkey.csv") as myfile:
        for line in myfile:
            name, var = line.partition("=")[::2]
            secret_key[name.strip()] = str(var.strip())

    # Setup mTurk parameters
    sandbox_host = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com/'
    # real_host = 'mechanicalturk.amazonaws.com'
    region_name = 'us-east-1'
    aws_access_key_id = secret_key["AWSAccessKeyId"]
    aws_secret_access_key = secret_key["AWSSecretKey"]

    mturk = boto3.client('mturk',
                         endpoint_url=sandbox_host,
                         region_name=region_name,
                         aws_access_key_id=aws_access_key_id,
                         aws_secret_access_key=aws_secret_access_key,
                         )

    # Sample line of code to get account balance [$10,000.00]
    print mturk.get_account_balance()['AvailableBalance']

    return mturk
