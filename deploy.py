import getpass
import os
import shutil
import inspect
import paramiko
import subprocess
import sys
import glob
import errno

import datetime
import re
import time

sidewalk_home_directory = "/var/www/html/sidewalk"
sidewalk_app_directory = sidewalk_home_directory + "/sidewalk-webpage"
hostname = "sidewalk.umiacs.umd.edu"

# Is not being used now
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
    print "SFTP port open. Starting to upload %s to %s" % (zip_file_path, sidewalk_home_directory)

    destination_filename = sidewalk_home_directory + "/" + zip_file_name
    sftp.put(zip_file_path, destination_filename)
    print "Finished uploading the file"
    sftp.close()
    transport.close()

# Functions to manage distribution files

def stop_existing_application():
    # rm_pid_cmd = "rm " + sidewalk_app_directory + "/RUNNING_PID"
    # subprocess.call(rm_pid_cmd.split())

    # Identify the running Play PID. If there is one, kill.
    play_pid_command="netstat -tulpn"
    p1 = subprocess.Popen(play_pid_command.split(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    p2 = subprocess.Popen(["grep", "9000"], stdin=p1.stdout, stdout=subprocess.PIPE)
    p3 = subprocess.Popen(["awk", "{print $7}"], stdin=p2.stdout, stdout=subprocess.PIPE)
    p4 = subprocess.Popen(["cut", "-d", "/", "-f", "1"], stdin=p3.stdout, stdout=subprocess.PIPE)
    p1.stdout.close()
    p2.stdout.close()
    p3.stdout.close()
    stdout, stderr = p4.communicate()
    play_pid_9000 = stdout.strip('\n')

    if play_pid_9000 != '':
        print "Running process has pid: " + play_pid_9000
        subprocess.call(["kill", play_pid_9000])
        print "Killed older application process"
    else:
        print "No running application process to kill"

def move_existing_application():
    """Check if the sidewalk-webpage directory exists already. If so, change the name of the directory"""
    print "Checking if the directory `sidewalk-webpage` already exists"
    command = "ls %s" % sidewalk_home_directory
    p = subprocess.Popen(command.split(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = p.communicate()
    ls_output = stdout.split("\n")

    if "sidewalk-webpage"  in ls_output:
        print "Changing the directory name from `sidewalk-webpage` to `_sidewalk-webpage`"
        command = "mv %s %s" % (sidewalk_app_directory,
                            sidewalk_home_directory + "/_sidewalk-webpage")
        subprocess.call(command.split())
    else:
        # Directory doesn't exist create one
        print "Directory `sidewalk-webpage` does not exist"

    # Create a new sidewalk-webpage folder
    command = "mkdir " + sidewalk_app_directory
    subprocess.call(command.split())
    print "Directory `sidewalk-webpage` created"

def unzip_file(zip_file_path):
    """Unzip and run the application"""
    print "Unzipping the files"
    # command = "bsdtar -xf %s -s'|[^/]*/||' -C %s" % (zip_file_path, sidewalk_app_directory)
    command = "unzip %s -d %s" % (zip_file_path, sidewalk_app_directory)
    p = subprocess.Popen(command.split(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = p.communicate()

    if stdout not in  ['', '\n']:
        print stdout
        zip_file_name = (zip_file_path.split('/')[-1]).replace(".zip", "")
        print "Zip Filename: " + zip_file_name

        unzipped_folder = os.path.join(sidewalk_app_directory, zip_file_name)
        print unzipped_folder
        for filename in os.listdir(unzipped_folder):
            file_to_move = os.path.join(unzipped_folder, filename)
            print "File to move:" + file_to_move

            try:
                shutil.copytree(file_to_move, os.path.join(sidewalk_app_directory, filename))
            except OSError as e:
                # If the error was caused because the source wasn't a directory
                if e.errno == errno.ENOTDIR:
                    shutil.copy(file_to_move, sidewalk_app_directory)
                else:
                    print('\tDirectory not copied. Error: %s' % e)

        shutil.rmtree(unzipped_folder)
    else:
        print "Error while unzipping:"
        print stderr
    print "Finished unzipping the files"

    # change_permission_command = "chmod g+w " + sidewalk_app_directory + "/*"
    # subprocess.call(change_permission_command.split())


def run_application():
    """Run the application"""
    print "Starting the application"
    command = "%s/sidewalk_runner.sh >/dev/null 2>&1 &" % sidewalk_home_directory
    subprocess.call(command.split())
    print "Started running the application"

def remove_previous_application():
    """Remove the application that was previously here"""
    print "Checking if the directory `_sidewalk-webpage` exists"
    command = "ls %s" % sidewalk_home_directory
    p = subprocess.Popen(command.split(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = p.communicate()
    ls_output = stdout.split("\n")

    if "_sidewalk-webpage" in ls_output:
        print "Removing `_sidewalk-webpage` directory"
        command = "rm -r %s" % sidewalk_home_directory + "/_sidewalk-webpage"
        subprocess.call(command.split())
    else:
        print "Directory `_sidewalk-webpage` does not exist"

# Functions to add timestamp to the deployed version
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

# Functions to create a binary distribution
def call_activator_dist():
    command = 'activator dist'
    subprocess.call(command.split())

def create_distribution():
    print "Adding timestamp to the footer"
    add_timestamp_to_the_footer()

    print "Started zipping up files"
    call_activator_dist()
    remove_timestamp_from_the_footer()

# Main Script
if __name__ == '__main__':
    if len(sys.argv) > 1:
        if sys.argv[1] == 'dist':
            create_distribution()

    else:
        # create_distribution()

        # Get created distribution file
        current_file_path = os.path.dirname(os.path.abspath(inspect.getfile(inspect.currentframe())))
        zip_file_path = os.path.join(current_file_path, "target/universal/")
        file_list = glob.glob(zip_file_path + "sidewalk-webpage-*.zip")
        zip_file_path = file_list[-1]
        print "File to be deployed: " + zip_file_path

        stop_existing_application()
        move_existing_application()
        unzip_file(zip_file_path)
        run_application()
        remove_previous_application()

