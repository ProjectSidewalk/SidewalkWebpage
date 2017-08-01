
if __name__ == '__main__':
    print 'Hello!'
    import requests
    # from requests.auth import HTTPDigestAuth
    import pandas as pd
    from pandas.io.json import json_normalize
    try:
        url = 'http://localhost:9000/labelsToCluster/6193/6193'
        response = requests.get(url)
        data = response.json()
        df = json_normalize(data[0])
        print df

    except:
        print "bleep bloop fail"