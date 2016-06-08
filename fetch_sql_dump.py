import getpass
import os
import paramiko

download_directory = "./download"
if not os.path.exists(download_directory):
    os.makedirs(download_directory)


def main(sql_dump_filename, username, password, hostname="sidewalk.umiacs.umd.edu"):
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
    sftp.get(remote_filename, "./download/" + sql_dump_filename)
    sftp.close()
    transport.close()
    print "Download complete"

if __name__ == '__main__':
    username = raw_input("Username:")
    password = getpass.getpass("Password:")
    main("test_dump.sql", username, password)
