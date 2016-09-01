function UserModel () {
    this._user = null;
}

_.extend(UserModel.prototype, Backbone.Events);

UserModel.prototype.getUser = function () {
    return this._user;
};