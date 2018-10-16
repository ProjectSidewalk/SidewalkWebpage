import fileinput
import sys


def anonymize(sql_filename):
    """This function reads in the sql dump for the sidewalk project and replaces all the email addresses and usernames
    with random strings.

    References:
    http://stackoverflow.com/questions/17140886/how-to-search-and-replace-text-in-a-file-using-python

    :param sql_filename:
    :return:
    """


    terminate_line = "\."
    copy_user_start_line = """COPY sidewalk_user (user_id, username, email) FROM stdin;"""
    copy_login_info_start_line = """COPY login_info (login_info_id, provider_id, provider_key) FROM stdin;"""


    read_user_table = False
    read_login_info_table = False

    output_file = open(sql_filename.replace(".sql", ".anonymized.sql"), "w")

    with open(sql_filename, 'r') as input_file:
        for line in input_file:
            if copy_user_start_line in line:
                read_user_table = True
                continue
            elif copy_login_info_start_line in line:
                read_login_info_table = True
                continue
            elif terminate_line in line:
                read_user_table = False
                read_login_info_table = False
                continue

            new_line = line

            # Substitute lines in the sidewalk_user table
            if read_user_table:
                line_list = line.split("\t")
                if line_list[1] != "anonymous":
                    email_address = line_list[2].strip()
                    current_user_index = get_user_index(email_address)

                    line_list[1] = "anonymized_user_name." + str(current_user_index)
                    line_list[2] = "anonymized." + str(current_user_index) + "@email.com\n"
                new_line = "\t".join(line_list)

            # Substitute lines in the login_info table
            if read_login_info_table:
                line_list = line.split("\t")
                email_address = line_list[2].strip()
                if "anonymous@cs.umd.edu" not in line_list[2]:
                    current_user_index = get_user_index(email_address)
                    line_list[2] = "anonymized." + str(current_user_index) + "@email.com\n"


                new_line = "\t".join(line_list)

            output_file.write(new_line)

    output_file.close()
    return


def get_user_index(email_address):
    if email_address in get_user_index.email_to_index:
        return get_user_index.email_to_index[email_address]
    else:
        current_user_index = get_user_index.user_index
        get_user_index.email_to_index[email_address] = current_user_index
        get_user_index.user_index += 1
        return current_user_index

get_user_index.user_index = 1
get_user_index.email_to_index = {}

if __name__ == '__main__':
    if len(sys.argv) > 1:
        sql_filename = sys.argv[1]
        anonymize(sql_filename)
    else:

        # print "Filename not specified. Usage: python anonymize.py <filename of the sql file>"
        sql_filename = "resources/sidewalk_20160629.sql"
        anonymize(sql_filename)
