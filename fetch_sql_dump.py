import getpass
import os
import paramiko
import subprocess
import sys

download_directory = "./resources"
if not os.path.exists(download_directory):
    os.makedirs(download_directory)


def fetch_sql_dump(sql_dump_filename, username, password, hostname="sidewalk.umiacs.umd.edu"):
    remote_home_directory = "/nfshomes/kotaro"
    remote_sql_dump_directory = remote_home_directory + "/sql_dump"
    remote_filename = remote_sql_dump_directory + "/" + sql_dump_filename

    # Create a sql dump
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname, username=username, password=password)
    stdin, stdout, stderr = client.exec_command('scl enable postgresql92 "./dump_sidewalk_tables.sh %s"' % sql_dump_filename)
    client.close()
    print "Created the database dump %s on the remote server" % sql_dump_filename

    # Download the file
    print "Downloading the database dump..."
    port = 22
    transport = paramiko.Transport((hostname, port))
    transport.connect(username=username, password=password)
    sftp = paramiko.SFTPClient.from_transport(transport)
    sftp.get(remote_filename, sql_dump_filename)
    sftp.close()
    transport.close()
    print "Download complete"


def overwrite_local_database(sql_dump_filename, username, password):
    command = "psql -d sidewalk -a -f %s -U %s" % (sql_dump_filename, username)
    command_list = command.split(" ")
    print "Start overwriting the local database"
    subprocess.call(command_list)
    print "Finished overwriting the local database"
    return


if __name__ == '__main__':
    if len(sys.argv) > 2:
        command = sys.argv[1]
        sql_dump_filename = sys.argv[2]

        if command == "fetch":
            username = raw_input("Username:")
            password = getpass.getpass("Password:")
            fetch_sql_dump(sql_dump_filename, username, password)
        elif command == "overwrite":
            username = raw_input("Username:")
            password = getpass.getpass("Password:")
            overwrite_local_database(sql_dump_filename, username, password)
        else:
            print "Unknown command. Usage: python database_tool.py <fetch | overwrite> <sql_filename>"

    else:
        print "Usage: python database_tool.py <fetch | overwrite> <filename>"
