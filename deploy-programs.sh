#!/bin/bash

scp -i ~/.ssh/xusd.pem -r target/{idl,deploy} surfpool@node.xusd.tima.kz:/home/surfpool/.surfpool/target/