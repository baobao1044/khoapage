#!/usr/bin/env python3
"""Structural analysis of the deobfuscated StealAnEgg Luau script."""
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "StealAnEggs_deobfuscated.luau"
data = open(path, encoding="utf-8").read()

i = data.find("setmetatable({")
print("setmetatable at", i)
depth = 0
start = i + len("setmetatable(")
j = start
while j < len(data):
    if data[j] == "{":
        depth += 1
    elif data[j] == "}":
        depth -= 1
        if depth == 0:
            break
    j += 1
print("first table closes at", j, "len", j - start)
mt_start = data.find("{", j + 1)
depth = 0
k = mt_start
while k < len(data):
    if data[k] == "{":
        depth += 1
    elif data[k] == "}":
        depth -= 1
        if depth == 0:
            break
    k += 1
print("metatable closes at", k, "len", k - mt_start)
print("after metatable:", repr(data[k + 1:k + 80]))
xo = data.find("Xo=function")
print("Xo=function at", xo)
wl = data.find("while E do", xo)
print("while E do at", wl)
lr = data.rfind("return ")
print("last return at", lr)
print("context:", repr(data[lr:lr + 120]))