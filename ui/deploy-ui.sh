#!/bin/bash

npm run build

scp -i ~/.ssh/xusd.pem -r dist/* root@46.101.229.153:/var/www/html/