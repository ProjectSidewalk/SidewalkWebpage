import getpass
import os
import paramiko
import subprocess
import sys

import datetime
import re
import time

remote_home_directory = "/var/www/html/sidewalk"
sidewalk_app_directory = remote_home_directory + "/sidewalk-webpage"
hostname = "sidewalk.umiacs.umd.edu"


def transfer_a_zipfile(zip_file_path, username, password):
    zip_file_name = os.path.split(zip_file_path)[1]
    port = 22

    # Upload the zip file to the remote server
    print "Connecting to %s" % hostname
    transport = paramiko.Transport((hostname, port))
    transport.connect(username=username, password=password)
    print "Connected to the host."
    print "Connecting to the SFTP port (%d)" % port
    sftp = paramiko.SFTPClient.from_transport(transport)
    print "SFTP port open. Starting to upload %s to %s" % (zip_file_path, sidewalk_app_directory)

    destination_filename = sidewalk_app_directory + "/" + zip_file_name
    sftp.put(zip_file_path, destination_filename)
    print "Finished uploading the file"
    sftp.close()
    transport.close()


def unzip_remote_file(client, zip_file_name):
    """Unzip and run the application"""
    print "Unzipping the files"
    command = "unzip %s -d %s" % (sidewalk_app_directory +
                                  "/" + zip_file_name, sidewalk_app_directory)
    stdin, stdout, stderr = client.exec_command(command, timeout=30)
    stdout.read()
    print "Finished unzipping the files"


def run_application(client):
    """Run the application"""
    print "Starting the application"
    command = "%s/sidewalk_runner.sh >/dev/null 2>&1 &" % sidewalk_app_directory
    stdin, stdout, stderr = client.exec_command(command)
    print "Started running the application."


def move_existing_application(client):
    """Check if the sidewalk-webpage directory exists already. If so, change the name of the directory"""
    print "Checking if the directory `sidewalk-webpage` already exists"
    command = "ls %s" % sidewalk_app_directory
    stdin, stdout, stderr = client.exec_command(command)
    ls_output = stdout.read().split("\n")
    if "sidewalk-webpage" in ls_output:
        print "Changing the directory name from `sidewalk-webpage` to `_sidewalk-webpage`"
        command = "mv %s %s" % (sidewalk_app_directory + "/sidewalk-webpage",
                                sidewalk_app_directory + "/_sidewalk-webpage")
        stdin, stdout, stderr = client.exec_command(command)
        stdout.read()
    else:
        print "Directory `sidewalk-webpage` does not exist"


def remove_previous_application(client):
    """Remove the application that was previously here"""
    print "Checking if the directory `_sidewalk-webpage` exists"
    command = "ls %s" % sidewalk_app_directory
    stdin, stdout, stderr = client.exec_command(command)
    ls_output = stdout.read().split("\n")
    if "_sidewalk-webpage" in ls_output:
        print "Removing `_sidewalk-webpage` directory"
        command = "rm -r %s" % sidewalk_app_directory + "/_sidewalk-webpage"
        stding, stdout, stderr = client.exec_command(command)
        print stdout.read()
    else:
        print "Directory `_sidewalk-webpage` does not exist"


def rename_new_application_directory(client, zip_file_name):
    """Change the directory name from `sidewalk-webpage-[Date]`to `sidewalk-webpage` and run the app"""
    unzipped_dir_name = zip_file_name.replace(".zip", "")
    print "Changing the directory name from %s to %s" % (unzipped_dir_name, "sidewalk-webpage")
    command = "mv %s %s" % (sidewalk_app_directory + "/" +
                            unzipped_dir_name, sidewalk_app_directory + "/sidewalk-webpage")
    stdin, stdout, stderr = client.exec_command(command)
    stdout.read()
    print "Finished renaming"


def add_timestamp_to_the_footer():

    with file("./app/views/main.scala.html", "r+") as f:
        file_contents = f.read()

        timestamp = datetime.datetime.fromtimestamp(time.time()).strftime('%Y-%m-%d')
        new_file_contents = re.sub(r"""<span id="application-version">.*</span>""",
                                   """<span id="application-version">Last updated: """ + timestamp + """</span>""",
                                   file_contents)

        f.seek(0)
        f.write(new_file_contents)
        f.truncate()


def remove_timestamp_from_the_footer():
    with file("./app/views/main.scala.html", "r+") as f:
        file_contents = f.read()
        new_file_contents = re.sub(r"""<span id="application-version">.*</span>""",
                                   """<span id="application-version"></span>""",
                                   file_contents)

        f.seek(0)
        f.write(new_file_contents)
        f.truncate()


def call_activator_dist():
    command = 'activator dist'
    subprocess.call(command.split())

if __name__ == '__main__':
    if len(sys.argv) > 1:
        if sys.argv[1] == 'dist':
            print "Adding timestamp to the footer"
            add_timestamp_to_the_footer()

            print "Started zipping up files"
            call_activator_dist()
            remove_timestamp_from_the_footer()

        elif sys.argv[1] == 'push':
            if len(sys.argv) > 2:
                zip_file_path = sys.argv[2]
                zip_file_name = os.path.split(zip_file_path)[1]
                username = raw_input("Username:")
                password = getpass.getpass("Password:")

                transfer_a_zipfile(zip_file_path, username, password)

                client = paramiko.SSHClient()
                client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                client.connect(hostname, username=username, password=password)

                unzip_remote_file(client, zip_file_name)
                move_existing_application(client)
                rename_new_application_directory(client, zip_file_name)
                run_application(client)
                remove_previous_application(client)

                client.close()
            else:
                print "Filename not specified. Usage: python deploy.py <filename of the zipped app>"
