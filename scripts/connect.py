import os
from os.path import expanduser
import boto3
import psycopg2
import psycopg2.extras
from sqlalchemy import create_engine


def connect_to_mturk():
    # Get key from an external file
    secret_key = {}

    with open("rootkey.csv") as myfile:
        for line in myfile:
            name, var = line.partition("=")[::2]
            secret_key[name.strip()] = str(var.strip())

    # Setup mTurk parameters
    #host = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com/'
    host = 'https://mturk-requester.us-east-1.amazonaws.com'
    region_name = 'us-east-1'
    aws_access_key_id = secret_key["AWSAccessKeyId"]
    aws_secret_access_key = secret_key["AWSSecretKey"]

    mturk = boto3.client('mturk',
                         endpoint_url=host,
                         region_name=region_name,
                         aws_access_key_id=aws_access_key_id,
                         aws_secret_access_key=aws_secret_access_key,
                         )

    # Sample line of code to get account balance [$10,000.00]
    print mturk.get_account_balance()['AvailableBalance']

    return mturk

def connect_to_db():

    home = expanduser("~")
    file_path = home + "/.pgpass"
    with open(file_path) as filename:

        arr = []
        for line in filename:
            l = line.strip()
            if l[0] != '#':
                arr = l.split(":")

        dbhost = arr[0]
        dbport = arr[1]
        dbname = arr[2]
        dbuser = arr[3]
        dbpass = arr[4]

        # Format of the connection string: dialect+driver://username:password@host:port/database
        connection_str = ('postgresql://' + dbuser + ':' + dbpass +
                          '@' + dbhost + ':' + dbport + '/' + dbname)
        print connection_str
        engine = create_engine(connection_str)
        conn = psycopg2.connect("dbname=" + dbname +
                                " user=" + dbuser +
                                " host=" + dbhost +
                                " port=" + dbport +
                                " password=" + dbpass + "")

        return conn, engine