import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from client import open_camera


class FakeCap:
    def __init__(self, opens, delivers):
        self.opens, self.delivers, self.released = opens, delivers, False

    def isOpened(self):
        return self.opens

    def read(self):
        return (True, object()) if self.delivers else (False, None)

    def release(self):
        self.released = True


class FakeCv2:
    def __init__(self, cams):
        self.cams, self.tried = cams, []

    def VideoCapture(self, i):
        self.tried.append(i)
        return self.cams.get(i, FakeCap(False, False))


def test_takes_first_camera_that_delivers_a_picture():
    cv2 = FakeCv2({0: FakeCap(True, False), 1: FakeCap(False, False), 2: FakeCap(True, True)})
    cap, index = open_camera(cv2)
    assert index == 2 and cv2.tried == [0, 1, 2]
    assert cv2.cams[0].released  # the one that opened but gave no frames is let go


def test_explicit_index_is_used_as_given():
    cv2 = FakeCv2({3: FakeCap(True, True)})
    assert open_camera(cv2, 3)[1] == 3 and cv2.tried == [3]
    assert open_camera(FakeCv2({}), 1) == (None, None)


def test_no_camera_returns_none():
    assert open_camera(FakeCv2({})) == (None, None)
